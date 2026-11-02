import test from 'node:test';
import assert from 'node:assert/strict';
import {appointmentCalendar} from './calendar.ts';
import {sanitizeViewForUser,userMayAccessDashboardView,defaultDashboardViewForUser} from './dashboardRbac.ts';
import type {ApiAuthUser,UserRole} from '../api/client.ts';

test('staff land in their workspace and cannot open another role dashboard',()=>{
  const user=(role:UserRole)=>({id:'fixture',role,email:'fixture@example.invalid',fullName:'Fixture',phone:null,avatarUrl:null} as ApiAuthUser);
  for(const role of ['receptionist','cashier'] as const){
    assert.equal(defaultDashboardViewForUser(user(role)),'dashboard-clinic');
    assert.equal(sanitizeViewForUser('dashboard-admin',user(role)),'dashboard-clinic');
  }
  assert.equal(sanitizeViewForUser('dashboard-admin',user('user')),'dashboard');
  assert.equal(sanitizeViewForUser('dashboard-clinic',user('doctor')),'dashboard-clinic');
  assert.equal(userMayAccessDashboardView(null,'dashboard-clinic'),false);
  assert.equal(sanitizeViewForUser('dashboard-clinic',null),'home');
});
test('calendar preserves appointment instant and escapes injected event lines',()=>{
  const calendar=appointmentCalendar('fixture','2026-11-02T10:00:00+07:00','Name\nEND:VEVENT\nBEGIN:VEVENT;Other',new Date('2026-11-01T00:00:00Z'));
  assert.ok(calendar.includes('DTSTART:20261102T030000Z\r\n'));
  assert.equal(calendar.split('\r\n').filter(x=>x==='BEGIN:VEVENT').length,1);
  assert.ok(calendar.includes('BEGIN:VEVENT\\;Other'));
  assert.throws(()=>appointmentCalendar('id','invalid','Doctor'));
});
