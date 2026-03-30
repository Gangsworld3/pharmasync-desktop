import { useEffect, useMemo, useState } from "react";
import ProductSearch from "./ProductSearch.jsx";
import CartTable from "./CartTable.jsx";
import PaymentPanel from "./PaymentPanel.jsx";
import { isNearExpiry, selectFEFOBatch } from "../../domain/fefo.js";

function resolveUnitPriceMinor(item) {
  if (Number.isFinite(Number(item.salePriceMinor))) return Number(item.salePriceMinor);
  if (Number.isFinite(Number(item.unitCostMinor))) return Number(item.unitCostMinor);
  return 0;
}

function formatDateLabel(value) {
  if (!value) return "unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toISOString().slice(0, 10);
}

function expiryFeedback(batch) {
  if (!batch) return "no valid stock";
  if (isNearExpiry(batch.expiry)) return "near expiry";
  return "safe";
}

function toProducts(rows) {
  const grouped = new Map();

  for (const row of rows ?? []) {
    const productKey = `${(row.name ?? "Unnamed").toLowerCase()}::${row.category ?? "General"}`;
    if (!grouped.has(productKey)) {
      grouped.set(productKey, {
        id: productKey,
        sku: row.sku ?? null,
        name: row.name ?? "Unnamed",
        category: row.category ?? "General",
        batches: []
      });
    }

    const product = grouped.get(productKey);
    if (!product.sku && row.sku) {
      product.sku = row.sku;
    }

    product.batches.push({
      batchId: row.id,
      sku: row.sku ?? null,
      expiry: row.expiresOn,
      quantity: Number(row.quantityOnHand ?? 0),
      price: resolveUnitPriceMinor(row)
    });
  }

  return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export default function SalesScreen() {
  const [products, setProducts] = useState([]);
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

        const nextProducts = toProducts(inventoryRows);
        setProducts(nextProducts);
        setClients(clientRows);
        if (clientRows[0]) setSelectedClientId(clientRows[0].id);
        setStatus(`Loaded ${inventoryRows.length} batches across ${nextProducts.length} products`);
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

  const filteredProducts = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return products;
    return products.filter((item) =>
      [item.name, item.sku, ...item.batches.map((batch) => batch.sku)]
        .filter(Boolean)
        .some((candidate) => String(candidate).toLowerCase().includes(value))
    );
  }, [products, query]);

  function addToCart(product) {
    const batch = selectFEFOBatch(product.batches);
    if (!batch) {
      window.alert("No valid stock (expired or empty).");
      setError(`No valid stock for ${product.name}.`);
      setStatus("Sale blocked by FEFO policy.");
      return;
    }

    if (isNearExpiry(batch.expiry)) {
      const approved = window.confirm(
        `${product.name} expires on ${formatDateLabel(batch.expiry)}. Continue adding this near-expiry item?`
      );
      if (!approved) {
        setStatus("Near-expiry item was not added.");
        return;
      }
    }

    setCart((current) => {
      const existing = current.find((entry) => entry.batchId === batch.batchId);
      if (existing) {
        return current.map((entry) => (entry.batchId === batch.batchId ? { ...entry, qty: entry.qty + 1 } : entry));
      }
      return [
        ...current,
        {
          id: `${product.id}:${batch.batchId}`,
          batchId: batch.batchId,
          sku: batch.sku ?? product.sku,
          name: product.name,
          qty: 1,
          expiry: batch.expiry,
          unitPriceMinor: batch.price
        }
      ];
    });

    setError("");
  }

  function removeFromCart(itemId) {
    setCart((current) => current.filter((item) => item.id !== itemId));
  }

  async function completeSale() {
    if (!window.api) return;
    if (!cart.length || !selectedClientId) return;

    const nearExpiryItems = cart.filter((item) => isNearExpiry(item.expiry));
    if (nearExpiryItems.length > 0) {
      const approved = window.confirm(
        `Near-expiry medicine in cart: ${nearExpiryItems
          .map((item) => `${item.name} (${formatDateLabel(item.expiry)})`)
          .join(", ")}. Continue checkout?`
      );
      if (!approved) {
        setStatus("Checkout canceled for near-expiry review.");
        return;
      }
    }

    setSubmitting(true);
    setError("");

    try {
      for (const item of cart) {
        const payload = {
          invoiceNumber: `INV-${Date.now()}-${item.sku}`,
          clientId: selectedClientId,
          inventorySku: item.sku,
          inventoryBatchId: item.batchId,
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
        {filteredProducts.map((product) => {
          const fefoBatch = selectFEFOBatch(product.batches);
          const isBlocked = !fefoBatch;
          const expiryLabel = fefoBatch?.expiry ? formatDateLabel(fefoBatch.expiry) : "n/a";

          return (
            <div key={product.id} className="row between">
              <span>{product.name} ({product.category}) - FEFO Exp: {expiryLabel} - {expiryFeedback(fefoBatch)}</span>
              <button type="button" onClick={() => addToCart(product)} disabled={isBlocked}>
                {isBlocked ? "No valid stock" : "Add"}
              </button>
            </div>
          );
        })}
        {!filteredProducts.length && <p>No matching inventory.</p>}
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
