import { useEffect, useMemo, useState } from "react";
import AddStockModal from "./AddStockModal.jsx";
import StockTable from "./StockTable.jsx";
import { expiryStatus } from "../../domain/expiry.js";
import { useCurrentUser } from "../../app/user-context.jsx";
import { callIpc, IPC_CHANNELS } from "../../lib/ipc-client.js";

export default function InventoryScreen() {
  const { currentUser } = useCurrentUser();
  const userRole = String(currentUser?.role ?? "").toLowerCase();
  const allowMutations = userRole === "admin" || userRole === "pharmacist";
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [editingBatch, setEditingBatch] = useState(null);
  const [filter, setFilter] = useState("ALL");
  const [status, setStatus] = useState("Loading inventory...");
  const [error, setError] = useState("");

  async function loadInventory() {
    if (!window.api?.invoke) return;
    try {
      const inventory = await callIpc(IPC_CHANNELS.INVENTORY_LIST);
      setRows(inventory);
      setStatus(`Loaded ${inventory.length} batches`);
    } catch (loadError) {
      setError(loadError.message ?? "Failed to load inventory.");
    }
  }

  useEffect(() => {
    loadInventory();
  }, []);

  const visibleRows = useMemo(() => {
    if (filter === "ALL") return rows;
    if (filter === "LOW_STOCK") return rows.filter((row) => Number(row.quantityOnHand) <= Number(row.reorderLevel));
    if (filter === "EXPIRED") return rows.filter((row) => expiryStatus(row.expiresOn).type === "expired");
    if (filter === "NEAR_EXPIRY") return rows.filter((row) => expiryStatus(row.expiresOn).type === "warning");
    return rows;
  }, [rows, filter]);

  async function handleSave(payload) {
    if (!allowMutations) {
      setError("Inventory mutations are not allowed for your role.");
      return;
    }
    if (!window.api?.invoke) return;
    setError("");
    try {
      if (editingBatch) {
        await callIpc(IPC_CHANNELS.INVENTORY_UPDATE, { batchId: editingBatch.id, payload });
        setStatus("Batch updated.");
      } else {
        await callIpc(IPC_CHANNELS.INVENTORY_CREATE, payload);
        setStatus("Batch added.");
      }
      setOpen(false);
      setEditingBatch(null);
      await loadInventory();
    } catch (saveError) {
      setError(saveError.message ?? "Failed to save batch.");
    }
  }

  async function handleAdjust(row, delta) {
    if (!allowMutations) {
      setError("Inventory mutations are not allowed for your role.");
      return;
    }
    if (!window.api?.invoke) return;
    setError("");
    try {
      await callIpc(IPC_CHANNELS.INVENTORY_ADJUST, { batchId: row.id, delta, reason: "inventory-quick-adjust" });
      setStatus(`Adjusted ${row.name} (${delta > 0 ? "+" : ""}${delta}).`);
      await loadInventory();
    } catch (adjustError) {
      setError(adjustError.message ?? "Failed to adjust stock.");
    }
  }

  function openCreate() {
    setEditingBatch(null);
    setOpen(true);
    setError("");
  }

  function openEdit(row) {
    setEditingBatch(row);
    setOpen(true);
    setError("");
  }

  return (
    <section className="inventory stack">
      <div className="row between">
        <h2>Inventory Batches</h2>
        <div className="row">
          {allowMutations ? <button type="button" onClick={openCreate}>Add Batch</button> : null}
          <button type="button" onClick={() => setFilter("ALL")} className={filter === "ALL" ? "active-action" : ""}>All</button>
          <button type="button" onClick={() => setFilter("LOW_STOCK")} className={filter === "LOW_STOCK" ? "active-action" : ""}>Low Stock</button>
          <button type="button" onClick={() => setFilter("NEAR_EXPIRY")} className={filter === "NEAR_EXPIRY" ? "active-action" : ""}>Near Expiry</button>
          <button type="button" onClick={() => setFilter("EXPIRED")} className={filter === "EXPIRED" ? "active-action" : ""}>Expired</button>
        </div>
      </div>

      <StockTable rows={visibleRows} onEdit={openEdit} onAdjust={handleAdjust} allowMutations={allowMutations} />
      <div className="card">
        <strong>Status:</strong> {status}
        {error ? <p className="danger">{error}</p> : null}
      </div>

      {allowMutations ? (
        <AddStockModal
          open={open}
          editingBatch={editingBatch}
          onClose={() => {
            setOpen(false);
            setEditingBatch(null);
          }}
          onSave={handleSave}
          errorMessage={error}
        />
      ) : null}
    </section>
  );
}
