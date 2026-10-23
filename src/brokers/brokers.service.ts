import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery } from 'mongoose';
import { Broker, BrokerDoc } from '../db/schemas';
import { Paginated, escapeRegex, pageParams } from '../common/pagination';
import { RegistryEntry, defaultSendEnabled } from './registry';
import { BrokersQuery, AdminBrokerPatchDto } from './brokers.dto';

export interface BrokerDtoShape {
  id: string;
  name: string;
  website: string | null;
  category: string;
  hqCountry: string | null;
  verificationStatus: string;
  lastVerified: string | null;
  channelTypes: string[];
  channels: { type: string; value: string; label?: string; verified: boolean }[];
  legalBasisNote: string | null;
  obstacles: string | null;
  idRequested: string | null;
  sendEnabled: boolean;
  notes: string | null;
}

export function toBrokerDto(b: Broker): BrokerDtoShape {
  return {
    id: b.slug,
    name: b.name,
    website: b.website ?? null,
    category: b.category,
    hqCountry: b.hqCountry ?? null,
    verificationStatus: b.verificationStatus,
    lastVerified: b.lastVerified ?? null,
    channelTypes: [...new Set(b.channels.map((c) => c.type))],
    channels: b.channels.map((c) => ({ type: c.type, value: c.value, ...(c.label ? { label: c.label } : {}), verified: c.verified })),
    legalBasisNote: b.legalBasisNote ?? null,
    obstacles: b.obstacles ?? null,
    idRequested: b.idRequested ?? null,
    sendEnabled: b.sendEnabled,
    notes: b.notes ?? null,
  };
}

const ITALY_FILTER: FilterQuery<Broker> = { $or: [{ domain: /\.it$/ }, { hqCountry: 'IT' }, { streams: 'C' }] };

@Injectable()
export class BrokersService {
  private readonly logger = new Logger(BrokersService.name);

  constructor(@InjectModel(Broker.name) private readonly brokers: Model<BrokerDoc>) {}

  /** Upserts the registry file. Admin-edited fields are never overwritten. */
  async seed(entries: RegistryEntry[]): Promise<{ created: number; updated: number }> {
    const existing = new Map((await this.brokers.find().select('slug adminEdited').lean()).map((b) => [b.slug, b.adminEdited ?? []]));
    const ops = entries.map((e) => {
      const edited = existing.get(e.slug);
      const registryFields = {
        name: e.name,
        website: e.website,
        domain: e.domain,
        category: e.category,
        hqCountry: e.hqCountry,
        legalBasisNote: e.legalBasisNote,
        obstacles: e.obstacles,
        idRequested: e.idRequested,
        streams: e.streams,
        lastVerified: e.lastVerified,
      };
      const guarded: Record<string, unknown> = {
        verificationStatus: e.verificationStatus,
        channels: e.channels,
        notes: e.notes,
        sendEnabled: defaultSendEnabled(e),
      };
      if (!edited) {
        return { insertOne: { document: { slug: e.slug, ...registryFields, ...guarded, adminEdited: [] } } };
      }
      const set: Record<string, unknown> = { ...registryFields };
      for (const [k, v] of Object.entries(guarded)) if (!edited.includes(k)) set[k] = v;
      return { updateOne: { filter: { slug: e.slug }, update: { $set: set } } };
    });
    if (ops.length) await this.brokers.bulkWrite(ops as never, { ordered: false });
    const created = entries.filter((e) => !existing.has(e.slug)).length;
    this.logger.log(`registry seeded: ${created} created, ${entries.length - created} updated`);
    return { created, updated: entries.length - created };
  }

  async list(q: BrokersQuery): Promise<Paginated<BrokerDtoShape>> {
    const filter: FilterQuery<Broker> = {};
    if (q.q) filter.name = { $regex: escapeRegex(q.q), $options: 'i' };
    if (q.category) filter.category = q.category;
    if (q.status) filter.verificationStatus = q.status;
    if (q.sendable !== undefined) filter.sendEnabled = q.sendable === 'true';
    const { page, limit, skip } = pageParams(q);
    const [items, total] = await Promise.all([
      this.brokers.find(filter).sort({ name: 1 }).skip(skip).limit(limit).lean(),
      this.brokers.countDocuments(filter),
    ]);
    return { items: items.map(toBrokerDto), total, page, limit };
  }

  async get(slug: string): Promise<BrokerDtoShape> {
    const b = await this.brokers.findOne({ slug }).lean();
    if (!b) throw new NotFoundException('Broker not found');
    return toBrokerDto(b);
  }

  async stats() {
    const [total, sendable, italySpecific, byCategory, byStatus] = await Promise.all([
      this.brokers.countDocuments(),
      this.brokers.countDocuments({ sendEnabled: true }),
      this.brokers.countDocuments(ITALY_FILTER),
      this.brokers.aggregate<{ _id: string; count: number }>([{ $group: { _id: '$category', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
      this.brokers.aggregate<{ _id: string; count: number }>([{ $group: { _id: '$verificationStatus', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    ]);
    return {
      total,
      sendable,
      italySpecific,
      byCategory: byCategory.map((c) => ({ category: c._id, count: c.count })),
      byStatus: byStatus.map((s) => ({ status: s._id, count: s.count })),
    };
  }

  async adminPatch(slug: string, patch: AdminBrokerPatchDto): Promise<BrokerDtoShape> {
    const b = await this.brokers.findOne({ slug });
    if (!b) throw new NotFoundException('Broker not found');
    const edited = new Set(b.adminEdited);
    if (patch.sendEnabled !== undefined) {
      b.sendEnabled = patch.sendEnabled;
      edited.add('sendEnabled');
    }
    if (patch.verificationStatus !== undefined) {
      b.verificationStatus = patch.verificationStatus;
      if (patch.verificationStatus === 'verified') b.lastVerified = new Date().toISOString().slice(0, 10);
      edited.add('verificationStatus');
    }
    if (patch.channels !== undefined) {
      b.channels = patch.channels.map((c) => ({ type: c.type, value: c.value, label: c.label, verified: c.verified }));
      edited.add('channels');
    }
    if (patch.notes !== undefined) {
      b.notes = patch.notes ?? undefined;
      edited.add('notes');
    }
    b.adminEdited = [...edited];
    await b.save();
    return toBrokerDto(b.toObject());
  }

  async count(): Promise<{ total: number; sendable: number }> {
    const [total, sendable] = await Promise.all([this.brokers.countDocuments(), this.brokers.countDocuments({ sendEnabled: true })]);
    return { total, sendable };
  }

  getRaw(slug: string): Promise<Broker | null> {
    return this.brokers.findOne({ slug }).lean();
  }

  /** Brokers eligible for automatic requests. */
  sendableBrokers(): Promise<Broker[]> {
    return this.brokers.find({ sendEnabled: true }).lean();
  }
}
