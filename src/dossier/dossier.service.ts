import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { createHash } from 'crypto';
import { zipSync } from 'fflate';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { Authorization, AuthorizationDoc, Message, MessageDoc, RemovalRequest, RequestDoc } from '../db/schemas';
import { Clock } from '../common/clock';
import { CryptoService } from '../common/crypto.service';
import { badRequest, CodedException } from '../common/errors';
import { PdfService } from '../pdf/pdf.service';
import { ProfileDataService } from '../profiles/profile-data.service';
import { fullName } from '../profiles/profile.types';
import { TimestampService } from './timestamp.service';

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const utf8 = (s: string) => Buffer.from(s, 'utf8');
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

const READ_ME = `Dossier probatorio generato da Cancellamy
=========================================

Contenuto
- 00-copertina.pdf: riepilogo e cronologia della pratica.
- 01-delega.pdf: la delega firmata dall'interessato.
- messaggi/: ogni email inviata o ricevuta (testo) e messaggi.json con le stesse informazioni.
- cronologia.json: gli eventi della pratica con data e ora (UTC).
- manifest.json: elenco dei file con la loro impronta SHA-256.
- manifest.sha256: impronta SHA-256 di manifest.json.
- manifest.tsr (facoltativo): marca temporale RFC 3161 dell'impronta di manifest.json.

Come verificare l'integrita'
1. Per ogni file elencato in manifest.json calcola l'impronta e confrontala:
     shasum -a 256 <file>            (macOS/Linux)
     Get-FileHash <file> -Algorithm SHA256   (Windows PowerShell)
2. Verifica che manifest.json non sia stato alterato:
     shasum -a 256 -c manifest.sha256
3. Se e' presente manifest.tsr, verifica la marca temporale con OpenSSL e il certificato dell'autorita' di marcatura:
     openssl ts -verify -data manifest.json -in manifest.tsr -CAfile <ca.pem> -untrusted <tsa.crt>
   La marca dimostra che quell'impronta esisteva alla data indicata; non attesta il contenuto.

Avvertenze
Il dossier e' un documento tecnico: non e' un parere legale e il suo valore probatorio va valutato da un professionista.
Le impronte provano che i file non sono cambiati dopo la generazione, non che il contenuto sia veritiero.
`;

@Injectable()
export class DossierService {
  constructor(
    @InjectModel(RemovalRequest.name) private readonly requests: Model<RequestDoc>,
    @InjectModel(Message.name) private readonly messages: Model<MessageDoc>,
    @InjectModel(Authorization.name) private readonly authorizations: Model<AuthorizationDoc>,
    private readonly data: ProfileDataService,
    private readonly crypto: CryptoService,
    private readonly pdf: PdfService,
    private readonly tsa: TimestampService,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async build(userId: string, requestId: string, withTimestamp: boolean): Promise<{ filename: string; data: Buffer }> {
    const req = await this.requests.findOne({ _id: requestId, userId: new Types.ObjectId(userId) });
    if (!req) throw new NotFoundException('Request not found');
    if (withTimestamp && !this.tsa.enabled) throw badRequest('Timestamping is not configured on this instance', 'FEATURE_DISABLED');
    const profile = await this.data.getOwned(userId, String(req.profileId));
    const pii = this.data.pii(profile);
    const generatedAt = this.clock.now();
    const msgs = await this.messages.find({ requestId: req._id }).sort({ at: 1 });

    const files: Record<string, Buffer> = {};
    const entries = msgs.map((m, i) => {
      const subject = this.crypto.decrypt(m.subjectEnc);
      const text = this.crypto.decrypt(m.textEnc);
      const dir = m.direction === 'out' ? 'inviato' : 'ricevuto';
      const body = [
        `Direzione: ${m.direction === 'out' ? 'inviata da Cancellamy' : 'ricevuta'}`,
        `Data (UTC): ${m.at.toISOString()}`,
        `Da: ${m.from}`,
        `A: ${m.to.join(', ')}`,
        `Oggetto: ${subject}`,
        `Metodo: ${m.via ?? '-'}${m.dryRun ? ' (modalita prova: non spedita)' : ''}`,
        `ID provider: ${m.providerId ?? '-'}`,
        `Allegati: ${m.attachments.map((a) => `${a.filename} (${a.contentType}, ${a.size ?? '?'} byte)`).join('; ') || 'nessuno'}`,
        `Classificazione automatica: ${m.classification ?? '-'}`,
        '',
        text,
        '',
      ].join('\n');
      const path = `messaggi/${String(i + 1).padStart(3, '0')}-${dir}-${stamp(m.at)}.txt`;
      files[path] = utf8(body);
      return {
        file: path,
        direction: m.direction,
        at: m.at.toISOString(),
        from: m.from,
        to: m.to,
        subject,
        via: m.via ?? null,
        dryRun: m.dryRun,
        providerId: m.providerId ?? null,
        classification: m.classification ?? null,
        attachments: m.attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, size: a.size ?? null })),
        textSha256: sha256(text),
      };
    });
    files['messaggi/messaggi.json'] = utf8(JSON.stringify(entries, null, 2));

    const timeline = req.timeline.map((t) => ({ at: t.at.toISOString(), type: t.type, status: t.status ?? null, note: t.note ?? null }));
    files['cronologia.json'] = utf8(JSON.stringify(timeline, null, 2));

    const auth = await this.authorizations.findOne({ profileId: profile._id }).sort({ signedAt: -1 });
    if (auth) files['01-delega.pdf'] = await this.data.renderDelegaPdf(profile, auth);

    const dateOnly = (d?: Date) => (d ? d.toISOString() : '-');
    const cover = [
      `Riferimento pratica: ${req.shortRef}`,
      `Tipo di richiesta: ${req.kind === 'access' ? 'accesso ai dati (art. 15 GDPR)' : 'cancellazione e opposizione (artt. 17 e 21 GDPR)'}`,
      `Interessato: ${fullName(pii)}`,
      `Destinatario: ${req.brokerName}${req.brokerWebsite ? ` (${req.brokerWebsite})` : ''}`,
      `Canale: ${req.channel === 'email' ? 'email' : 'azione manuale'}`,
      `Stato attuale: ${req.status}`,
      `Ciclo: ${req.cycle}`,
      '',
      `Creata il (UTC): ${dateOnly(req.createdAt)}`,
      `Inviata il (UTC): ${dateOnly(req.sentAt)}`,
      `Scadenza di risposta (UTC): ${dateOnly(req.dueAt)}`,
      `Conclusa il (UTC): ${dateOnly(req.completedAt)}`,
      `Solleciti inviati: ${req.reminderCount}`,
      `Messaggi in archivio: ${msgs.length}`,
      '',
      'CRONOLOGIA',
      ...timeline.map((t) => `- ${t.at}  ${t.type}${t.status ? ` -> ${t.status}` : ''}${t.note ? `  (${t.note})` : ''}`),
      '',
      'INTEGRITA',
      "Ogni file del dossier e' elencato in manifest.json con la sua impronta SHA-256; l'impronta del manifest e' in manifest.sha256.",
      'Istruzioni di verifica in LEGGIMI.txt.',
    ].join('\n');
    files['00-copertina.pdf'] = await this.pdf.render({
      title: `Dossier probatorio - ${req.shortRef}`,
      body: cover,
      meta: `Generato da ${this.config.operatorName} il ${generatedAt.toISOString()} (UTC)`,
      footer: ['Documento tecnico: non e\' un parere legale.'],
    });
    files['LEGGIMI.txt'] = utf8(READ_ME);

    const manifestFiles = Object.entries(files)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, data]) => ({ path, sha256: sha256(data), bytes: data.length }));
    const manifest = {
      version: 1,
      generator: 'cancellamy',
      generatedAt: generatedAt.toISOString(),
      request: { id: String(req._id), shortRef: req.shortRef, kind: req.kind ?? 'erasure', broker: req.brokerName, status: req.status },
      hashAlgorithm: 'SHA-256',
      files: manifestFiles,
    };
    const manifestBuf = utf8(JSON.stringify(manifest, null, 2));
    const manifestHash = sha256(manifestBuf);
    files['manifest.json'] = manifestBuf;
    files['manifest.sha256'] = utf8(`${manifestHash}  manifest.json\n`);
    if (withTimestamp) {
      try {
        files['manifest.tsr'] = await this.tsa.stamp(manifestHash);
      } catch (err) {
        throw new CodedException(502, `Timestamp authority unavailable: ${(err as Error).message}`, 'TIMESTAMP_UNAVAILABLE');
      }
    }

    const zipInput: Record<string, [Uint8Array, { mtime: Date }]> = {};
    for (const [path, data] of Object.entries(files)) zipInput[path] = [data, { mtime: generatedAt }];
    return { filename: `dossier-${req.shortRef}.zip`, data: Buffer.from(zipSync(zipInput, { level: 6 })) };
  }
}
