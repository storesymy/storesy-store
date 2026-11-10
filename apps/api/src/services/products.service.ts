import type { CreateProductInput, Product, UpdateProductInput } from "@storesy/shared";
import { notFound } from "../core/errors";
import * as filesModel from "./files.service";
import * as imagesModel from "./images.service";
import * as productsModel from "../models/products.repository";
import type { ProductData, ProductRow } from "../models/schema";
import { klNow } from "./time";
import { entityUuid, ID_PREFIX } from "./uuid";

/**
 * Human-facing product id: `PRD-<zero-padded rowid>` — replaces the old SKU
 * concept. AUTOINCREMENT never reuses rowids, so codes are stable and unique.
 */
export function productCode(id: number): string {
  return `PRD-${String(id).padStart(4, "0")}`;
}

/** Public product shape: id = uuid, non-indexed fields flattened out of data. */
export function toPublicProduct(row: ProductRow): Product {
  const data = row.data as ProductData;
  return {
    id: row.uuid,
    name: row.name,
    code: productCode(row.id),
    description: data.description ?? "",
    sku: data.sku ?? "",
    price: data.price,
    discountPrice: data.discountPrice ?? null,
    stock: data.stock,
    status: data.status,
    type: data.type,
    weightKg: data.weightKg ?? null,
    widthCm: data.widthCm ?? null,
    heightCm: data.heightCm ?? null,
    lengthCm: data.lengthCm ?? null,
    featured: data.featured ?? null,
    gallery: data.gallery ?? [],
    downloadLinks: data.downloadLinks ?? [],
    downloadFiles: data.downloadFiles ?? [],
    fulfilment: data.fulfilment ?? { shipment: true, download: false },
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

/** The deployment's whole catalog — installs are single-tenant, so no owner filter. */
export async function list(env: Env): Promise<Product[]> {
  const rows = await productsModel.listProducts(env);
  return rows.map(toPublicProduct);
}

export async function get(env: Env, uuid: string): Promise<Product> {
  const row = await productsModel.findProductByUuid(env, uuid);
  if (!row) throw notFound("product_not_found", "No product with that id");
  return toPublicProduct(row);
}

export async function update(env: Env, uuid: string, input: UpdateProductInput): Promise<Product> {
  const row = await productsModel.findProductByUuid(env, uuid);
  if (!row) throw notFound("product_not_found", "No product with that id");

  const data = row.data as ProductData;
  const previousFeatured = data.featured ?? null;
  const previousGallery = data.gallery ?? [];
  const previousFiles = data.downloadFiles ?? [];
  const nextFeatured = input.featured !== undefined ? input.featured : previousFeatured;
  const nextGallery = input.gallery !== undefined ? input.gallery : previousGallery;
  const nextFiles = input.downloadFiles !== undefined ? input.downloadFiles : previousFiles;

  const updated = await productsModel.updateProduct(env, row.id, {
    ...(input.name !== undefined ? { name: input.name } : {}),
    data: {
      ...data,
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.sku !== undefined ? { sku: input.sku } : {}),
      ...(input.stock !== undefined ? { stock: input.stock } : {}),
      ...(input.price !== undefined ? { price: input.price } : {}),
      ...(input.discountPrice !== undefined ? { discountPrice: input.discountPrice } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.weightKg !== undefined ? { weightKg: input.weightKg } : {}),
      ...(input.widthCm !== undefined ? { widthCm: input.widthCm } : {}),
      ...(input.heightCm !== undefined ? { heightCm: input.heightCm } : {}),
      ...(input.lengthCm !== undefined ? { lengthCm: input.lengthCm } : {}),
      featured: nextFeatured,
      gallery: nextGallery,
      ...(input.downloadLinks !== undefined ? { downloadLinks: input.downloadLinks } : {}),
      downloadFiles: nextFiles,
      ...(input.fulfilment !== undefined ? { fulfilment: input.fulfilment } : {}),
      updatedAt: klNow(),
    },
  });

  // Delete-on-save: drop R2 objects the row no longer references. The row is
  // already written, so a cleanup failure only leaves an orphan — never a
  // product pointing at bytes that are gone. File keys are per-product, so no
  // other row can reference them.
  const droppedImages = [
    ...(previousFeatured !== null && previousFeatured !== nextFeatured ? [previousFeatured] : []),
    ...previousGallery.filter((path) => !nextGallery.includes(path)),
  ];
  const droppedFiles = previousFiles
    .filter((file) => !nextFiles.some((next) => next.path === file.path))
    .map((file) => file.path);
  if (droppedImages.length > 0) {
    try {
      await imagesModel.deleteImages(env, droppedImages);
    } catch (error) {
      console.error("image_delete_failed", error);
    }
  }
  if (droppedFiles.length > 0) {
    try {
      await filesModel.deleteFiles(env, droppedFiles);
    } catch (error) {
      console.error("file_delete_failed", error);
    }
  }

  return toPublicProduct(updated);
}

export async function create(env: Env, input: CreateProductInput): Promise<Product> {
  const now = klNow();
  const row = await productsModel.insertProduct(env, {
    uuid: entityUuid(ID_PREFIX.product),
    name: input.name,
    data: {
      description: "",
      sku: "",
      price: 0,
      discountPrice: null,
      stock: 0,
      status: "active",
      type: input.type,
      weightKg: null,
      widthCm: null,
      heightCm: null,
      lengthCm: null,
      featured: null,
      gallery: [],
      downloadLinks: [],
      downloadFiles: [],
      // Default matches the form: Shipment on, Download off.
      fulfilment: { shipment: true, download: false },
      createdAt: now,
      updatedAt: now,
    },
  });
  return toPublicProduct(row);
}
