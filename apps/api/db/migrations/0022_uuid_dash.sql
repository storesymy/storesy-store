-- Public ids now use a dash between the prefix and the UUIDv7: `prd-0199…`
-- (was `prd_0199…`). Every uuid column is rewritten, then the JSON references
-- that point at those rows. Stored R2 paths keep their old keys (the image,
-- file and page objects live under them); validators accept both separators.

UPDATE `users` SET `uuid` = replace(`uuid`, 'usr_', 'usr-');--> statement-breakpoint
UPDATE `products` SET `uuid` = replace(`uuid`, 'prd_', 'prd-');--> statement-breakpoint
UPDATE `sales_pages` SET `uuid` = replace(`uuid`, 'spg_', 'spg-');--> statement-breakpoint
UPDATE `integrations` SET `uuid` = replace(`uuid`, 'itg_', 'itg-');--> statement-breakpoint
UPDATE `orders` SET `uuid` = replace(`uuid`, 'ord_', 'ord-');--> statement-breakpoint
UPDATE `customers` SET `uuid` = replace(`uuid`, 'cus_', 'cus-');--> statement-breakpoint
UPDATE `customer_contact` SET `uuid` = replace(`uuid`, 'cdt_', 'cdt-');--> statement-breakpoint
-- Order lines point at product uuids.
UPDATE `orders` SET `data` = json_set(`data`, '$.items', (
	SELECT json_group_array(
		json_set(`value`, '$.product', replace(json_extract(`value`, '$.product'), 'prd_', 'prd-'))
	)
	FROM json_each(json_extract(`orders`.`data`, '$.items'))
))
WHERE json_extract(`data`, '$.items') IS NOT NULL;--> statement-breakpoint
-- A paid order keeps the integration it went through.
UPDATE `orders` SET `data` = json_set(`data`, '$.payment.integration', replace(json_extract(`data`, '$.payment.integration'), 'itg_', 'itg-'))
WHERE json_extract(`data`, '$.payment.integration') LIKE 'itg\_%' ESCAPE '\';--> statement-breakpoint
-- Sales pages point at products and integrations.
UPDATE `sales_pages` SET `data` = json_set(`data`, '$.checkoutProducts', (
	SELECT json_group_array(replace(`value`, 'prd_', 'prd-'))
	FROM json_each(json_extract(`sales_pages`.`data`, '$.checkoutProducts'))
))
WHERE json_extract(`data`, '$.checkoutProducts') IS NOT NULL;--> statement-breakpoint
UPDATE `sales_pages` SET `data` = json_set(`data`, '$.paymentGateway', replace(json_extract(`data`, '$.paymentGateway'), 'itg_', 'itg-'))
WHERE json_extract(`data`, '$.paymentGateway') LIKE 'itg\_%' ESCAPE '\';--> statement-breakpoint
UPDATE `sales_pages` SET `data` = json_set(`data`, '$.emailSender', replace(json_extract(`data`, '$.emailSender'), 'itg_', 'itg-'))
WHERE json_extract(`data`, '$.emailSender') LIKE 'itg\_%' ESCAPE '\';--> statement-breakpoint
UPDATE `sales_pages` SET `data` = json_set(`data`, '$.trackings', (
	SELECT json_group_array(replace(`value`, 'itg_', 'itg-'))
	FROM json_each(json_extract(`sales_pages`.`data`, '$.trackings'))
))
WHERE json_extract(`data`, '$.trackings') IS NOT NULL;
