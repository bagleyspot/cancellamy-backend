export interface AuthUser {
  id: string;
  email: string;
  role: 'user' | 'admin';
  emailVerified: boolean;
}

export interface JwtPayload {
  sub: string;
  role: 'user' | 'admin';
}
