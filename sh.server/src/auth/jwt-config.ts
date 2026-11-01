import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';

// A process-local development key avoids a reusable, public fallback secret.
const developmentSecret = randomBytes(48).toString('hex');

export function jwtSecret(config: ConfigService): string {
  const configured = config.get<string>('JWT_SECRET')?.trim();
  if (configured) {
    if (config.get<string>('NODE_ENV') === 'production' &&
        (configured.length < 32 || configured === 'smart-hospital-secret-change-in-production')) {
      throw new Error('JWT_SECRET phải là bí mật riêng có ít nhất 32 ký tự trong production.');
    }
    return configured;
  }
  if (config.get<string>('NODE_ENV') === 'production') {
    throw new Error('Thiếu JWT_SECRET trong production.');
  }
  return developmentSecret;
}
