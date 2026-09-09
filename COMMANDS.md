# parcel-events-cli commands

19 command(s). Prefer `parcel-events-cli find <query>` and `parcel-events-cli --schema`.
Stable id is `x-operation-key`, not the speakable path.

| command | wire |
| --- | --- |
| `labels create` | POST /v1/labels |
| `labels retrieve` | GET /v1/labels/{label_id} |
| `pickups cancel` | DELETE /v1/pickups/{pickup_id} |
| `pickups create` | POST /v1/pickups |
| `pickups list` | GET /v1/pickups |
| `pickups retrieve` | GET /v1/pickups/{pickup_id} |
| `rates quote` | POST /v1/rates/quote |
| `shipments cancel` | DELETE /v1/shipments/{shipment_id} |
| `shipments create` | POST /v1/shipments |
| `shipments events list` | GET /v1/shipments/{shipment_id}/events |
| `shipments list` | GET /v1/shipments |
| `shipments retrieve` | GET /v1/shipments/{shipment_id} |
| `shipments update` | PATCH /v1/shipments/{shipment_id} |
| `retrieve` | GET /v1/tracking/{tracking_number} |
| `webhook-endpoints create` | POST /v1/webhook-endpoints |
| `webhook-endpoints get` | GET /v1/webhook-endpoints/{endpoint_id} |
| `webhook-endpoints list` | GET /v1/webhook-endpoints |
| `webhook-endpoints remove` | DELETE /v1/webhook-endpoints/{endpoint_id} |
| `webhook-endpoints update` | PATCH /v1/webhook-endpoints/{endpoint_id} |
