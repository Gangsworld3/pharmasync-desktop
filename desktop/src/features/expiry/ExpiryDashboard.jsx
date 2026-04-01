import { useEffect, useMemo, useState } from "react";
import { t } from "../../i18n/i18n.js";
import ExpiryList from "./ExpiryList.jsx";
import { callIpc, IPC_CHANNELS } from "../../lib/ipc-client.js";

function daysUntil(value) {
  if (!value) return Number.POSITIVE_INFINITY;
  const diff = (new Date(value).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return Number.isFinite(diff) ? diff : Number.POSITIVE_INFINITY;
}

function classify(dateValue) {
  const days = daysUntil(dateValue);
  if (days < 0) return "EXPIRED";
  if (days <= 30) return "D30";
  if (days <= 60) return "D60";
  if (days <= 90) return "D90";
  return "SAFE";
}

export default function ExpiryDashboard() {
  const [rows, setRows] = useState([]);
  const [bucket, setBucket] = useState("D30");
  const [status, setStatus] = useState("Loading expiry data...");

  useEffect(() => {
    async function load() {
      if (!window.api?.invoke) return;
      const inventory = await callIpc(IPC_CHANNELS.INVENTORY_LIST);
      setRows(inventory);
      setStatus(`Loaded ${inventory.length} inventory batches`);
    }
    load().catch((error) => setStatus(error.message ?? "Failed to load expiry data."));
  }, []);

  const counts = useMemo(() => {
    const buckets = { EXPIRED: 0, D30: 0, D60: 0, D90: 0, SAFE: 0 };
    for (const row of rows) {
      buckets[classify(row.expiresOn)] += 1;
    }
    return buckets;
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (bucket === "ALL") return rows;
    return rows.filter((row) => classify(row.expiresOn) === bucket);
  }, [rows, bucket]);

  return (
    <section className="stack">
      <div className="row">
        <div className="card danger">Expired: {counts.EXPIRED}</div>
        <div className="card warning">30 days: {counts.D30}</div>
        <div className="card warning">60 days: {counts.D60}</div>
        <div className="card warning">90 days: {counts.D90}</div>
      </div>
      <div className="row">
        <button type="button" onClick={() => setBucket("EXPIRED")} className={bucket === "EXPIRED" ? "active-action" : ""}>{t("expired")}</button>
        <button type="button" onClick={() => setBucket("D30")} className={bucket === "D30" ? "active-action" : ""}>30d</button>
        <button type="button" onClick={() => setBucket("D60")} className={bucket === "D60" ? "active-action" : ""}>60d</button>
        <button type="button" onClick={() => setBucket("D90")} className={bucket === "D90" ? "active-action" : ""}>90d</button>
        <button type="button" onClick={() => setBucket("ALL")} className={bucket === "ALL" ? "active-action" : ""}>{t("all")}</button>
      </div>
      <div className="card">
        <strong>Daily Check:</strong> Review {filteredRows.length} batches in "{bucket}" bucket.
      </div>
      <ExpiryList rows={filteredRows.map((row) => ({
        id: row.id,
        name: `${row.name} (${row.batchNumber ?? row.sku})`,
        date: row.expiresOn
      }))} />
      <div className="card"><strong>Status:</strong> {status}</div>
    </section>
  );
}
