import { SmsService } from './sms.service';
import { loadConfig } from '../config/app-config';

const make = (env: Record<string, string>) => new SmsService(loadConfig({ NODE_ENV: 'test', ...env }));

describe('SmsService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('is disabled without a provider and refuses to send', async () => {
    const sms = make({});
    expect(sms.enabled).toBe(false);
    await expect(sms.send('+39333', 'x')).rejects.toMatchObject({ status: 404 });
  });

  it('dry-run only logs', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const sms = make({ SMS_PROVIDER: 'dry-run' });
    expect(sms.enabled).toBe(true);
    await sms.send('+39333', 'codice 123456');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('twilio posts a form with Basic auth and surfaces provider failures', async () => {
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 201 }));
    const sms = make({ SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'ACtest', TWILIO_AUTH_TOKEN: 'secret', TWILIO_FROM: '+15005550006' });
    await sms.send('+393331234567', 'Il tuo codice è 123456');
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('ACtest:secret').toString('base64')}`);
    expect(String(init.body)).toContain('To=%2B393331234567');
    expect(String(init.body)).toContain('From=%2B15005550006');
    spy.mockResolvedValue(new Response('{}', { status: 500 }));
    await expect(sms.send('+393331234567', 'x')).rejects.toMatchObject({ status: 503 });
  });
});
