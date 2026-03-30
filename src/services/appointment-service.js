import { createLocalAppointment, listAppointments } from "../db/repositories.js";

export function listLocalAppointments() {
  return listAppointments();
}

export function createAppointment(payload) {
  return createLocalAppointment(payload);
}
