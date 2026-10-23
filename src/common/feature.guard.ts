import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { APP_CONFIG, AppConfig, FeatureName } from '../config/app-config';
import { CodedException } from './errors';

export const FEATURE_KEY = 'feature';
/** Marks an endpoint (or controller) as belonging to a feature an operator can switch off (FEATURES_DISABLED). */
export const Feature = (name: FeatureName) => SetMetadata(FEATURE_KEY, name);

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const name = this.reflector.getAllAndOverride<FeatureName | undefined>(FEATURE_KEY, [context.getHandler(), context.getClass()]);
    if (name && this.config.featuresDisabled.includes(name)) {
      throw new CodedException(404, 'This feature is disabled on this instance', 'FEATURE_DISABLED');
    }
    return true;
  }
}
