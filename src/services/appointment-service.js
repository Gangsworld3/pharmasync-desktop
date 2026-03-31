import { createLocalAppointment, listAppointments } from "../db/repositories/appointmentRepo.js";

export function listLocalAppointments() {
  return listAppointments();
}

export function createAppointment(payload) {
  return createLocalAppointment(payload);
}
