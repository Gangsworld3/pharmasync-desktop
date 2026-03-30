import { useEffect, useState } from "react";
import Modal from "../../components/shared/Modal.jsx";
import Input from "../../components/shared/Input.jsx";
import { t } from "../../i18n/i18n.js";

function initialForm() {
  return {
    sku: "",
    name: "",
    category: "General",
    quantityOnHand: "0",
    reorderLevel: "0",
    unitCostMinor: "0",
    salePriceMinor: "0",
    batchNumber: "",
    expiresOn: ""
  };
}

function toFormValues(batch) {
  if (!batch) return initialForm();
  return {
    sku: batch.sku ?? "",
    name: batch.name ?? "",
    category: batch.category ?? "General",
    quantityOnHand: String(batch.quantityOnHand ?? 0),
    reorderLevel: String(batch.reorderLevel ?? 0),
    unitCostMinor: String(batch.unitCostMinor ?? 0),
    salePriceMinor: String(batch.salePriceMinor ?? 0),
    batchNumber: batch.batchNumber ?? "",
    expiresOn: batch.expiresOn ? new Date(batch.expiresOn).toISOString().slice(0, 10) : ""
  };
}

export default function AddStockModal({ open, onClose, onSave, editingBatch, errorMessage }) {
  const [form, setForm] = useState(initialForm());

  useEffect(() => {
    if (!open) return;
    setForm(toFormValues(editingBatch));
  }, [open, editingBatch]);

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    await onSave({
      sku: form.sku.trim(),
      name: form.name.trim(),
      category: form.category.trim() || "General",
      quantityOnHand: Number(form.quantityOnHand),
      reorderLevel: Number(form.reorderLevel),
      unitCostMinor: Number(form.unitCostMinor),
      salePriceMinor: Number(form.salePriceMinor),
      batchNumber: form.batchNumber.trim() || null,
      expiresOn: form.expiresOn ? new Date(`${form.expiresOn}T00:00:00.000Z`).toISOString() : null
    });
  }

  return (
    <Modal open={open} title={editingBatch ? "Edit Batch" : t("addStock")} onClose={onClose}>
      <form className="stack" onSubmit={handleSubmit}>
        <Input label="Medicine" placeholder="Name" value={form.name} onChange={(event) => updateField("name", event.target.value)} required />
        <Input label="SKU" placeholder="AMOX-500-A" value={form.sku} onChange={(event) => updateField("sku", event.target.value)} required disabled={Boolean(editingBatch)} />
        <Input label="Category" placeholder="General" value={form.category} onChange={(event) => updateField("category", event.target.value)} />
        <Input label="Quantity" type="number" min="0" step="1" value={form.quantityOnHand} onChange={(event) => updateField("quantityOnHand", event.target.value)} required />
        <Input label="Reorder Level" type="number" min="0" step="1" value={form.reorderLevel} onChange={(event) => updateField("reorderLevel", event.target.value)} required />
        <Input label="Unit Cost (minor)" type="number" min="0" step="1" value={form.unitCostMinor} onChange={(event) => updateField("unitCostMinor", event.target.value)} required />
        <Input label="Sale Price (minor)" type="number" min="0" step="1" value={form.salePriceMinor} onChange={(event) => updateField("salePriceMinor", event.target.value)} required />
        <Input label="Batch No" placeholder="B-001" value={form.batchNumber} onChange={(event) => updateField("batchNumber", event.target.value)} />
        <Input label="Expiry" type="date" value={form.expiresOn} onChange={(event) => updateField("expiresOn", event.target.value)} />
        {errorMessage ? <p className="danger">{errorMessage}</p> : null}
        <div className="row">
          <button type="button" onClick={onClose}>Close</button>
          <button type="submit">{editingBatch ? "Update" : "Save"}</button>
        </div>
      </form>
    </Modal>
  );
}
