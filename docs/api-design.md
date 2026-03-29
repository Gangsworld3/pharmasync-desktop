# API Design

Base path: `/api/v1`

Authentication:

- `POST /auth/login`
- `POST /auth/otp/challenge`
- `POST /auth/otp/verify`
- `POST /auth/refresh`
- `POST /auth/logout`

Tenancy and configuration:

- `GET /me`
- `GET /settings`
- `PATCH /settings`
- `GET /currencies`
- `GET /localization/languages`

## CRM

- `GET /clients`
- `POST /clients`
- `GET /clients/{clientId}`
- `PATCH /clients/{clientId}`
- `GET /clients/{clientId}/interactions`
- `POST /clients/{clientId}/interactions`
- `GET /client-tags`
- `POST /client-tags`

Example create client payload:

```json
{
  "fullName": "Mariam Deng",
  "type": "retail",
  "phone": "+211921000111",
  "preferredLanguage": "ar",
  "tags": ["chronic-care", "mobile-money"],
  "addressLine": "Hai Malakia",
  "city": "Juba"
}
```

## Scheduling

- `GET /appointments`
- `POST /appointments`
- `PATCH /appointments/{appointmentId}`
- `POST /appointments/{appointmentId}/confirm`
- `POST /appointments/{appointmentId}/cancel`
- `GET /staff/availability`

## Inventory

- `GET /products`
- `POST /products`
- `PATCH /products/{productId}`
- `GET /stock/batches`
- `POST /stock/receipts`
- `POST /stock/adjustments`
- `POST /stock/transfers`
- `GET /stock/alerts`

## Billing and payments

- `GET /invoices`
- `POST /invoices`
- `GET /invoices/{invoiceId}`
- `POST /invoices/{invoiceId}/issue`
- `POST /invoices/{invoiceId}/void`
- `POST /payments`
- `GET /payments`
- `GET /payment-methods`

Payment example:

```json
{
  "invoiceId": "inv_10342",
  "method": "mobile_money",
  "providerCode": "mtn",
  "currencyCode": "SSP",
  "amountMinor": 950000,
  "externalReference": "MTN-8841992"
}
```

## Messaging

- `GET /messages/threads`
- `POST /messages/send`
- `POST /messages/templates`
- `POST /messages/campaigns`
- `POST /messages/webhooks/sms-status`

## Documents

- `POST /documents/upload`
- `GET /documents`
- `GET /documents/{documentId}/download`
- `DELETE /documents/{documentId}`

## Reporting

- `GET /reports/dashboard`
- `GET /reports/revenue`
- `GET /reports/inventory`
- `GET /reports/appointments`
- `POST /reports/export`

## User and role management

- `GET /users`
- `POST /users`
- `PATCH /users/{userId}`
- `GET /roles`
- `POST /roles`
- `PATCH /roles/{roleId}`

## Sync

- `POST /sync/push`
- `POST /sync/pull`
- `GET /sync/status`
- `POST /sync/conflicts/{eventId}/resolve`

## API principles

- version every route under `/api/v1`
- financial and inventory actions are append-heavy and auditable
- bulk endpoints for low-bandwidth sync and imports
- idempotency keys on payment, invoice issue, and sync routes
- provider adapters hidden behind internal service boundaries
