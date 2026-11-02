import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ClinicService } from './clinic.service';
import type { ClinicActor } from './clinic.rules';

@Controller('clinic')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClinicController {
  constructor(private readonly clinic: ClinicService) {}
  @Get('patients')
  patients(@CurrentUser() actor: ClinicActor, @Query('q') q = '', @Query('page') page = '1') { return this.clinic.patients(actor, q, Number(page)); }
  @Post('patients')
  createPatient(@CurrentUser() actor: ClinicActor, @Body() body: Record<string, unknown> = {}) { return this.clinic.createPatient(actor, body); }
  @Patch('patients/:id')
  updatePatient(@CurrentUser() actor: ClinicActor, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown> = {}) { return this.clinic.updatePatient(actor, id, body); }
  @Post('patients/:id/access')
  grantAccess(@CurrentUser() actor: ClinicActor, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown> = {}) { return this.clinic.grantAccess(actor, id, body); }
  @Delete('patients/:id/access/:userId')
  revokeAccess(@CurrentUser() actor: ClinicActor, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string) { return this.clinic.revokeAccess(actor, id, userId); }
  @Get('doctors')
  doctors() { return this.clinic.doctors(); }
  @Get('accounts')
  accounts(@CurrentUser() actor: ClinicActor, @Query('q') q = '') { return this.clinic.accounts(actor, q); }
  @Get('patients/:id/access')
  access(@CurrentUser() actor: ClinicActor, @Param('id', ParseUUIDPipe) id: string) { return this.clinic.patientAccess(actor, id); }
  @Get('appointments')
  appointments(@CurrentUser() actor: ClinicActor, @Query('day') day: string) { return this.clinic.bookableAppointments(actor, day); }
  @Post('appointments/:id/import')
  importAppointment(@CurrentUser() actor: ClinicActor, @Param('id', ParseUUIDPipe) id: string) { return this.clinic.importAppointment(actor, id); }
  @Get('visits')
  visits(@CurrentUser() actor: ClinicActor, @Query('day') day: string, @Query('status') status = '') { return this.clinic.visits(actor, day, status); }
  @Post('visits')
  createVisit(@CurrentUser() actor: ClinicActor, @Body() body: Record<string, unknown> = {}) { return this.clinic.createVisit(actor, body); }
  @Get('visits/:id')
  detail(@CurrentUser() actor: ClinicActor, @Param('id', ParseUUIDPipe) id: string) { return this.clinic.detail(actor, id); }
  @Post('visits/:id/transition')
  transition(@CurrentUser() actor: ClinicActor, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown> = {}) { return this.clinic.transition(actor, id, body); }
  @Post('visits/:id/encounter')
  encounter(@CurrentUser() actor: ClinicActor, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown> = {}) { return this.clinic.saveEncounter(actor, id, body); }
  @Post('visits/:id/collections')
  collect(@CurrentUser() actor: ClinicActor, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown> = {}) { return this.clinic.collect(actor, id, body); }
  @Post('visits/:id/refunds')
  requestRefund(@CurrentUser() actor: ClinicActor, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown> = {}) { return this.clinic.requestRefund(actor, id, body); }
  @Post('refunds/:id/review')
  reviewRefund(@CurrentUser() actor: ClinicActor, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown> = {}) { return this.clinic.reviewRefund(actor, id, body); }
  @Post('refunds/:id/pay')
  payRefund(@CurrentUser() actor: ClinicActor, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown> = {}) { return this.clinic.payRefund(actor, id, body); }
  @Post('visits/:id/transfer')
  transfer(@CurrentUser() actor: ClinicActor, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown> = {}) { return this.clinic.transfer(actor, id, body); }
  @Post('payments/:id/reconciliation')
  reconcilePayment(@CurrentUser() actor: ClinicActor, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown> = {}) { return this.clinic.reconcilePayment(actor, id, body); }
  @Post('visits/:id/reconciliation/resolve')
  resolveReconciliation(@CurrentUser() actor: ClinicActor, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown> = {}) { return this.clinic.resolveReconciliation(actor, id, body); }
  @Get('waitlist')
  waitlist(@CurrentUser() actor: ClinicActor) { return this.clinic.waitlist(actor); }
  @Post('waitlist')
  addWaitlist(@CurrentUser() actor: ClinicActor, @Body() body: Record<string, unknown> = {}) { return this.clinic.addWaitlist(actor, body); }
  @Post('waitlist/:id/offer')
  offerWaitlist(@CurrentUser() actor: ClinicActor, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown> = {}) { return this.clinic.offerWaitlist(actor, id, body); }
  @Post('waitlist/:id/confirm')
  confirmWaitlist(@CurrentUser() actor: ClinicActor, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown> = {}) { return this.clinic.confirmWaitlist(actor, id, body); }
  @Post('waitlist/:id/cancel')
  cancelWaitlist(@CurrentUser() actor: ClinicActor, @Param('id', ParseUUIDPipe) id: string) { return this.clinic.cancelWaitlist(actor, id); }
  @Get('follow-ups')
  followUps(@CurrentUser() actor: ClinicActor) { return this.clinic.followUps(actor); }
  @Get('operations')
  operations(@CurrentUser() actor: ClinicActor) { return this.clinic.operations(actor); }
  @Get('operations/tasks')
  tasks(@CurrentUser() actor: ClinicActor) { return this.clinic.operationTasks(actor); }
  @Post('operations/tasks')
  claimTask(@CurrentUser() actor: ClinicActor, @Body() body: Record<string, unknown> = {}) { return this.clinic.claimTask(actor, body); }
  @Patch('operations/tasks/:id')
  updateTask(@CurrentUser() actor: ClinicActor, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown> = {}) { return this.clinic.updateTask(actor, id, body); }
  @Get('audit/:id')
  audit(@CurrentUser() actor: ClinicActor, @Param('id', ParseUUIDPipe) id: string) { return this.clinic.auditTrail(actor, id); }
}

