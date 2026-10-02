import type { AuthConfig } from './types.js';
import { isPasswordHash } from './password.js';

type Env = NodeJS.ProcessEnv;

const list = (value: string | undefined) =>
  new Set(
    (value ?? '')
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean)
  );

const requireSecret = (env: Env, name: string, mode: string) => {
  const value = env[name]?.trim();
  if (!value || value.length < 32) throw new Error(`${name} (min. 32 chars) is required when AUTH_MODE=${mode}`);
  return value;
};

const sessionDays = (env: Env) => {
  const days = Number(env.SESSION_DAYS ?? 30);
  if (!Number.isFinite(days) || days <= 0 || days > 365) throw new Error('SESSION_DAYS must be between 1 and 365');
  return days;
};

/**
 * Leest de auth-configuratie. Modi:
 * - password (standaard): ingebouwde login met één gebruiker
 * - proxy: vertrouwt een gebruikersheader van een reverse proxy (Authelia, Authentik, oauth2-proxy, …)
 * - cosmos: preset van proxy voor Cosmos Cloud (x-cosmos-user)
 * - oidc: inloggen via een OpenID Connect-provider
 * - dev: geen auth, alleen buiten productie
 */
export function loadAuthConfig(env: Env): AuthConfig {
  const mode = (env.AUTH_MODE?.trim() || 'password').toLowerCase();

  switch (mode) {
    case 'dev':
      if (env.NODE_ENV === 'production') throw new Error('AUTH_MODE=dev is not allowed when NODE_ENV=production');
      return { mode: 'dev' };

    case 'proxy':
    case 'cosmos': {
      const cosmos = mode === 'cosmos';
      const allowedUsers = list(env.ALLOWED_USERS);
      if (allowedUsers.size === 0) throw new Error(`ALLOWED_USERS is required when AUTH_MODE=${mode}`);
      return {
        mode: 'proxy',
        userHeader: (env.PROXY_USER_HEADER?.trim() || (cosmos ? 'x-cosmos-user' : 'remote-user')).toLowerCase(),
        secretHeader: (env.PROXY_SECRET_HEADER?.trim() || 'x-proxy-secret').toLowerCase(),
        secret: requireSecret(env, 'PROXY_SECRET', mode),
        allowedUsers,
        loginPath: env.PROXY_LOGIN_PATH?.trim() || '/api/login'
      };
    }

    case 'password': {
      const username = env.AUTH_USERNAME?.trim();
      if (!username) throw new Error('AUTH_USERNAME is required when AUTH_MODE=password');
      const hash = env.AUTH_PASSWORD_HASH?.trim() || null;
      const plain = env.AUTH_PASSWORD ?? null;
      if (hash && !isPasswordHash(hash)) throw new Error('AUTH_PASSWORD_HASH is not a valid scrypt hash (use: npm run hash-password)');
      if (!hash && !plain) throw new Error('AUTH_PASSWORD_HASH (or AUTH_PASSWORD) is required when AUTH_MODE=password');
      if (!hash && plain && plain.length < 12) throw new Error('AUTH_PASSWORD must be at least 12 characters');
      return {
        mode: 'password',
        username,
        passwordHash: hash,
        passwordPlain: hash ? null : plain,
        sessionSecret: requireSecret(env, 'SESSION_SECRET', mode),
        sessionDays: sessionDays(env),
        trustProxy: env.TRUST_PROXY === 'true'
      };
    }

    case 'oidc': {
      const required = (name: string) => {
        const value = env[name]?.trim();
        if (!value) throw new Error(`${name} is required when AUTH_MODE=oidc`);
        return value;
      };
      const issuer = new URL(required('OIDC_ISSUER'));
      const redirect = new URL(required('OIDC_REDIRECT_URL'));
      const local = (u: URL) => u.hostname === 'localhost' || u.hostname === '127.0.0.1';
      if (issuer.protocol !== 'https:' && !local(issuer)) throw new Error('OIDC_ISSUER must use https');
      if (redirect.protocol !== 'https:' && !local(redirect)) throw new Error('OIDC_REDIRECT_URL must use https');
      if (redirect.pathname !== '/auth/oidc/callback') throw new Error('OIDC_REDIRECT_URL must end with /auth/oidc/callback');
      // Vergelijking zonder hoofdlettergevoeligheid: providers schrijven e-mailadressen niet altijd gelijk.
      const allowedUsers = new Set([...list(env.ALLOWED_USERS)].map((u) => u.toLowerCase()));
      if (allowedUsers.size === 0) throw new Error('ALLOWED_USERS is required when AUTH_MODE=oidc');
      return {
        mode: 'oidc',
        issuer: issuer.toString(),
        clientId: required('OIDC_CLIENT_ID'),
        clientSecret: env.OIDC_CLIENT_SECRET?.trim() || null,
        redirectUrl: redirect.toString(),
        scopes: env.OIDC_SCOPES?.trim() || 'openid profile email',
        userClaim: env.OIDC_USER_CLAIM?.trim() || 'email',
        allowedUsers,
        sessionSecret: requireSecret(env, 'SESSION_SECRET', mode),
        sessionDays: sessionDays(env)
      };
    }

    default:
      throw new Error('AUTH_MODE must be one of: password, proxy, cosmos, oidc, dev');
  }
}
