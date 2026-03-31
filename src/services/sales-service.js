import { listInvoices } from "../db/repositories/salesRepo.js";
import { createInvoiceTransaction } from "./offline-service.js";

export function listLocalInvoices() {
  return listInvoices();
}

export function createInvoice(payload, actor = "desktop-user") {
  return createInvoiceTransaction(payload, actor);
}
