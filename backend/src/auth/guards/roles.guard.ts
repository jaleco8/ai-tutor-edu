import { CanActivate, ExecutionContext, Injectable, ForbiddenException, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SupabaseService } from '../../common/supabase.service';
import { Request } from 'express';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly supabase: SupabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const userId = (request as any).userId as string;

    if (!userId) {
      throw new ForbiddenException('User not authenticated');
    }

    const client = this.supabase.getClient();
    const { data: profile } = await client
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single();

    if (!profile || !requiredRoles.includes(profile.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    (request as any).userRole = profile.role;

    return true;
  }
}
