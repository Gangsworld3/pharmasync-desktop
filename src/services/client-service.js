import { createLocalClient, listClients, updateLocalClient } from "../db/repositories.js";

export function listLocalClients() {
  return listClients();
}

export function createClient(payload) {
  return createLocalClient(payload);
}

export function updateClient(clientId, payload) {
  return updateLocalClient(clientId, payload);
}
