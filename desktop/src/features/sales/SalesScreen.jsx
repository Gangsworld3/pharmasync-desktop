import { useEffect, useMemo, useState } from "react";
import ProductSearch from "./ProductSearch.jsx";
import CartTable from "./CartTable.jsx";
import PaymentPanel from "./PaymentPanel.jsx";

function resolveUnitPriceMinor(item) {
  if (Number.isFinite(Number(item.salePriceMinor))) return Number(item.salePriceMinor);
  if (Number.isFinite(Number(item.unitCostMinor))) return Number(item.unitCostMinor);
  return 0;
}

function fefoSort(items) {
  return [...items].sort((a, b) => {
    const left = a.expiresOn ? new Date(a.expiresOn).getTime() : Number.POSITIVE_INFINITY;
    const right = b.expiresOn ? new Date(b.expiresOn).getTime() : Number.POSITIVE_INFINITY;
    return left - right;
  });
}

export default function SalesScreen() {
  const [inventory, setInventory] = useState([]);
  const [clients, setClients] = useState([]);
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("Loading inventory...");
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadInitialData() {
      if (!window.api) {
        setError("Electron API bridge is not available.");
        return;
      }

      try {
        const [inventoryRows, clientRows] = await Promise.all([
          window.api.listInventory(),
          window.api.listClients()
        ]);
        if (!mounted) return;
        setInventory(fefoSort(inventoryRows));
        setClients(clientRows);
        if (clientRows[0]) setSelectedClientId(clientRows[0].id);
        setStatus(`Loaded ${inventoryRows.length} items`);
      } catch (loadError) {
        if (!mounted) return;
        setError(loadError.message ?? "Failed to load inventory.");
      }
    }

    loadInitialData();
    return () => {
      mounted = false;
    };
  }, []);

  const filteredInventory = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return inventory;
    return inventory.filter((item) =>
      [item.name, item.sku, item.batchNumber]
        .filter(Boolean)
        .some((candidate) => String(candidate).toLowerCase().includes(value))
    );
  }, [inventory, query]);

  function addToCart(item) {
    setCart((current) => {
      const existing = current.find((entry) => entry.id === item.id);
      if (existing) {
        return current.map((entry) => (entry.id === item.id ? { ...entry, qty: entry.qty + 1 } : entry));
      }
      return [
        ...current,
        {
          id: item.id,
          sku: item.sku,
          name: item.name,
          qty: 1,
          expiry: item.expiresOn,
          unitPriceMinor: resolveUnitPriceMinor(item)
        }
      ];
    });
  }

  function removeFromCart(itemId) {
    setCart((current) => current.filter((item) => item.id !== itemId));
  }

  async function completeSale() {
    if (!window.api) return;
    if (!cart.length || !selectedClientId) return;

    setSubmitting(true);
    setError("");

    try {
      for (const item of cart) {
        const payload = {
          invoiceNumber: `INV-${Date.now()}-${item.sku}`,
          clientId: selectedClientId,
          inventorySku: item.sku,
          quantity: item.qty,
          totalMinor: item.qty * item.unitPriceMinor,
          paymentMethod
        };
        await window.api.createInvoice(payload);
      }
      await window.api.runSync();
      setStatus("Sale created and sync triggered.");
      setCart([]);
    } catch (saleError) {
      setError(saleError.message ?? "Failed to complete sale.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="sales stack">
      <ProductSearch query={query} onQueryChange={setQuery} />

      <div className="card stack">
        <h3>Products</h3>
        {filteredInventory.map((item) => (
          <div key={item.id} className="row between">
            <span>{item.name} ({item.sku})</span>
            <button type="button" onClick={() => addToCart(item)}>Add</button>
          </div>
        ))}
        {!filteredInventory.length && <p>No matching inventory.</p>}
      </div>

      <CartTable items={cart} onRemove={removeFromCart} />
      <PaymentPanel
        items={cart}
        clients={clients}
        selectedClientId={selectedClientId}
        onSelectClient={setSelectedClientId}
        paymentMethod={paymentMethod}
        onSelectPaymentMethod={setPaymentMethod}
        onCompleteSale={completeSale}
        isSubmitting={submitting}
      />

      <div className="card">
        <strong>Status:</strong> {status}
        {error ? <p className="danger">{error}</p> : null}
      </div>
    </section>
  );
}
