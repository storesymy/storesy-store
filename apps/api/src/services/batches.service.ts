import type { AwbBatch } from "@storesy/shared";
import { badRequest, notFound } from "../core/errors";
import * as batchesModel from "../models/batches.repository";
import * as ordersModel from "../models/orders.repository";
import type { BatchRow } from "../models/schema";
import * as myParcel from "./myParcel.service";

function toDto(row: BatchRow): AwbBatch {
  const data = row.data;
  return {
    id: row.uuid,
    date: data.createdAt,
    orderCount: data.orderCount,
    couriers: [...data.courierLabels],
    ...(data.integrationName ? { integrationName: data.integrationName } : {}),
  };
}

/** GET /api/fulfilment/batches — newest AWB batch first. */
export async function list(env: Env): Promise<AwbBatch[]> {
  const rows = await batchesModel.listBatches(env);
  return rows.map(toDto);
}

/** One combined consignment-note PDF for every tracking number in a batch. */
export async function printLabel(
  env: Env,
  uuid: string,
): Promise<{ body: ArrayBuffer; filename: string }> {
  const row = await batchesModel.findBatchByUuid(env, uuid);
  if (!row) throw notFound("batch_not_found", "No batch with that id");

  const trackingNos = await ordersModel.listTrackingNosForBatch(env, row.id);
  if (trackingNos.length === 0) {
    throw badRequest("batch_has_no_labels", "This batch has no tracking numbers to print.");
  }

  const body = await myParcel.getConsignmentNote(
    env,
    row.data.integrationId,
    trackingNos,
  );
  return { body, filename: `${row.uuid}.pdf` };
}
