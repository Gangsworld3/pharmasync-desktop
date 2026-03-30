import { useEffect, useMemo, useState } from "react";
import { useCurrentUser } from "../../app/user-context.jsx";

function isoDate(daysAgo = 0) {
  const dt = new Date();
  dt.setUTCDate(dt.getUTCDate() - daysAgo);
  return dt.toISOString().slice(0, 10);
}

export default function AnalyticsDashboard() {
  const { currentUser } = useCurrentUser();
  const [fromDate, setFromDate] = useState(isoDate(6));
  const [toDate, setToDate] = useState(isoDate(0));
  const [daysWindow, setDaysWindow] = useState(30);
  const [dailySales, setDailySales] = useState([]);
  const [topMedicines, setTopMedicines] = useState([]);
  const [expiryLoss, setExpiryLoss] = useState(null);
  const [status, setStatus] = useState("Loading analytics...");
  const [error, setError] = useState("");

  const canViewAnalytics = useMemo(() => {
    const role = String(currentUser?.role ?? "").toLowerCase();
    return role === "admin" || role === "pharmacist" || role === "cashier";
  }, [currentUser]);

  async function loadAnalytics() {
    if (!window.api || !canViewAnalytics) {
      return;
    }
    try {
      setError("");
      setStatus("Loading analytics...");
      const [daily, top, expiry] = await Promise.all([
        window.api.getDailySalesAnalytics({ from: fromDate, to: toDate }),
        window.api.getTopMedicinesAnalytics({ from: fromDate, to: toDate, limit: 10 }),
        window.api.getExpiryLossAnalytics({ days: daysWindow })
      ]);
      setDailySales(daily ?? []);
      setTopMedicines(top ?? []);
      setExpiryLoss(expiry ?? null);
      setStatus("Analytics loaded.");
    } catch (loadError) {
      setError(loadError.message ?? "Failed to load analytics.");
      setStatus("Analytics load failed.");
    }
  }

  useEffect(() => {
    void loadAnalytics();
  }, [canViewAnalytics]);

  if (!canViewAnalytics) {
    return (
      <section className="stack">
        <h2>Analytics</h2>
        <p className="danger">You do not have permission to view analytics.</p>
      </section>
    );
  }

  return (
    <section className="stack">
      <div className="row between">
        <h2>Analytics Dashboard</h2>
        <div className="row">
          <label>
            From
            <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          </label>
          <label>
            Expiry Window
            <select value={daysWindow} onChange={(event) => setDaysWindow(Number(event.target.value))}>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days</option>
            </select>
          </label>
          <button type="button" onClick={loadAnalytics}>Refresh</button>
        </div>
      </div>

      <div className="card">
        <h3>Daily Sales</h3>
        {!dailySales.length ? <p>No sales in selected range.</p> : (
          <table>
            <thead>
              <tr><th>Date</th><th>Total (minor)</th></tr>
            </thead>
            <tbody>
              {dailySales.map((row) => (
                <tr key={row.date}>
                  <td>{row.date}</td>
                  <td>{row.total_minor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>Top Medicines</h3>
        {!topMedicines.length ? <p>No medicine sales in selected range.</p> : (
          <table>
            <thead>
              <tr><th>SKU</th><th>Name</th><th>Qty Sold</th><th>Revenue (minor)</th></tr>
            </thead>
            <tbody>
              {topMedicines.map((row) => (
                <tr key={row.inventory_item_id}>
                  <td>{row.sku}</td>
                  <td>{row.name}</td>
                  <td>{row.quantity_sold}</td>
                  <td>{row.revenue_minor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>Expiry Loss Estimate</h3>
        <p>Total estimated loss (minor): <strong>{expiryLoss?.total_loss_minor ?? 0}</strong></p>
        <p>Window days: {expiryLoss?.window_days ?? daysWindow}</p>
      </div>

      <div className="card">
        <strong>Status:</strong> {status}
        {error ? <p className="danger">{error}</p> : null}
      </div>
    </section>
  );
}

