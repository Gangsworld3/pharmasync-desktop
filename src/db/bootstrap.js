import { prisma } from "./client.js";
import { getOfflineSummary } from "./repositories.js";

export async function bootstrapLocalDatabase() {
  const summary = await getOfflineSummary();

  if (summary.clients > 0) {
    return summary;
  }

  const mariam = await prisma.client.create({
    data: {
      clientCode: "CLI-0001",
      fullName: "Mariam Deng",
      phone: "+211921000111",
      preferredLanguage: "ar",
      city: "Juba",
      notes: "Chronic care client. Prefers SMS reminders."
    }
  });

  const peter = await prisma.client.create({
    data: {
      clientCode: "CLI-0002",
      fullName: "Peter Lado",
      phone: "+211923443220",
      preferredLanguage: "en",
      city: "Juba",
      notes: "Walk-in client with fast checkout preference."
    }
  });

  await prisma.invoice.createMany({
    data: [
      {
        invoiceNumber: "INV-2026-1042",
        clientId: mariam.id,
        currencyCode: "SSP",
        totalMinor: 645000,
        balanceDueMinor: 645000,
        paymentMethod: "mobile_money",
        status: "ISSUED",
        issuedAt: new Date()
      },
      {
        invoiceNumber: "INV-2026-1043",
        clientId: peter.id,
        currencyCode: "SSP",
        totalMinor: 180000,
        balanceDueMinor: 0,
        paymentMethod: "cash",
        status: "PAID",
        issuedAt: new Date()
      }
    ]
  });

  await prisma.inventoryItem.createMany({
    data: [
      {
        sku: "AMOX-500",
        name: "Amoxicillin 500mg",
        category: "Antibiotic",
        quantityOnHand: 124,
        reorderLevel: 40,
        unitCostMinor: 180000,
        salePriceMinor: 240000,
        batchNumber: "AMX-2409-01",
        expiresOn: new Date("2026-09-30")
      },
      {
        sku: "ORS-001",
        name: "ORS Sachets",
        category: "Hydration",
        quantityOnHand: 42,
        reorderLevel: 50,
        unitCostMinor: 40000,
        salePriceMinor: 70000
      },
      {
        sku: "GLU-STRIP",
        name: "Glucose Strips",
        category: "Diagnostics",
        quantityOnHand: 18,
        reorderLevel: 30,
        unitCostMinor: 250000,
        salePriceMinor: 340000
      }
    ]
  });

  await prisma.appointment.createMany({
    data: [
      {
        clientId: mariam.id,
        serviceType: "Medication review",
        staffName: "Dr. Lemi",
        startsAt: new Date(Date.now() + 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 90 * 60 * 1000),
        status: "CONFIRMED",
        notes: "Check refill compliance."
      },
      {
        clientId: peter.id,
        serviceType: "Follow-up consultation",
        staffName: "Achan",
        startsAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
        status: "PENDING",
        notes: "Walk-in converted to scheduled follow-up."
      }
    ]
  });

  await prisma.message.createMany({
    data: [
      {
        clientId: mariam.id,
        channel: "SMS",
        direction: "outbound",
        recipient: mariam.phone,
        body: "Your refill is ready at Juba Main Store.",
        deliveryStatus: "queued"
      },
      {
        clientId: peter.id,
        channel: "SMS",
        direction: "outbound",
        recipient: peter.phone,
        body: "Your appointment is scheduled for this afternoon.",
        deliveryStatus: "sent",
        sentAt: new Date()
      }
    ]
  });

  return getOfflineSummary();
}
