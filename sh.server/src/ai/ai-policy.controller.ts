import { Body, Controller, Delete, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserPublic } from '../models/user.model';
import { AiPolicyService } from './ai-policy.service';

@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiPolicyController {
  constructor(private readonly policy: AiPolicyService) {}
  @Get('policy') status(@CurrentUser() user: UserPublic) { return this.policy.status(user.id); }
  @Post('consent') consent(@CurrentUser() user: UserPublic, @Body() body: { accepted?: boolean; policyVersion?: string }) { return this.policy.consent(user.id, body ?? {}); }
  @Delete('consent') revoke(@CurrentUser() user: UserPublic) { return this.policy.revoke(user.id); }
  @Patch('policy') @Roles('admin') configure(@CurrentUser() user: UserPublic, @Body() body: { enabled?: boolean; confirmDataProcessing?: boolean }) { return this.policy.configure(user.id, body ?? {}); }
}
