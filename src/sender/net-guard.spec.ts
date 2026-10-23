import { HostNotAllowedError, isPrivateAddress, resolvePublicHost } from './net-guard';

describe('net-guard', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    'not-an-ip',
  ])('treats %s as private', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '93.184.216.34', '2606:4700:4700::1111'])('treats %s as public', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });

  it('accepts a public IP literal and refuses private ones and unknown hosts', async () => {
    await expect(resolvePublicHost('8.8.8.8')).resolves.toBe('8.8.8.8');
    await expect(resolvePublicHost('10.0.0.1')).rejects.toBeInstanceOf(HostNotAllowedError);
    await expect(resolvePublicHost('localhost')).rejects.toBeInstanceOf(HostNotAllowedError);
    await expect(resolvePublicHost('')).rejects.toBeInstanceOf(HostNotAllowedError);
    await expect(resolvePublicHost('does-not-exist.invalid')).rejects.toBeInstanceOf(HostNotAllowedError);
  });
});
