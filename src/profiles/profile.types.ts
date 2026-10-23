export interface AddressPii {
  street: string;
  city: string;
  zip: string;
  province?: string;
  country: string;
}

/** Decrypted personal data of a profile (never persisted in clear text). */
export interface ProfilePii {
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
  emails: string[];
  phones: string[];
  addresses: AddressPii[];
  fiscalCode?: string;
  aliases: string[];
}

export function fullName(p: Pick<ProfilePii, 'firstName' | 'lastName'>): string {
  return `${p.firstName.trim()} ${p.lastName.trim()}`.replace(/\s+/g, ' ');
}

export function formatAddress(a: AddressPii): string {
  const city = [a.zip, a.city].filter(Boolean).join(' ');
  return [a.street, city, a.province ? `(${a.province})` : '', a.country].filter(Boolean).join(', ').replace(', (', ' (');
}
