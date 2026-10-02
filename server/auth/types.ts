export type ProxyAuth = {
  mode: 'proxy';
  /** Header met de gebruikersnaam die de reverse proxy na login zet (lowercase). */
  userHeader: string;
  /** Header met een gedeeld geheim dat alleen de proxy meestuurt (lowercase). */
  secretHeader: string;
  secret: string;
  allowedUsers: Set<string>;
  /** Pad waar de browser heen moet om (opnieuw) in te loggen via de proxy. */
  loginPath: string;
};

export type PasswordAuth = {
  mode: 'password';
  username: string;
  /** scrypt-hash in het formaat van `hashPassword` (aanbevolen). */
  passwordHash: string | null;
  /** Platte tekst uit AUTH_PASSWORD; alleen gebruikt als er geen hash is. */
  passwordPlain: string | null;
  sessionSecret: string;
  sessionDays: number;
  trustProxy: boolean;
};

export type OidcAuth = {
  mode: 'oidc';
  issuer: string;
  clientId: string;
  clientSecret: string | null;
  redirectUrl: string;
  scopes: string;
  userClaim: string;
  allowedUsers: Set<string>;
  sessionSecret: string;
  sessionDays: number;
};

export type DevAuth = { mode: 'dev' };

export type AuthConfig = ProxyAuth | PasswordAuth | OidcAuth | DevAuth;

export type PublicAuthMode = 'proxy' | 'password' | 'oidc' | 'dev';
