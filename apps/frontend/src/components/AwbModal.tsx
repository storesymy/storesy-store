import type { AwbGenerateResult } from "@storesy/shared";
import { Button, Icon } from "@storesy/ui";

interface Props {
  busy: boolean;
  result: AwbGenerateResult | null;
  error: string | undefined;
  onClose: () => void;
}

/**
 * The AWB booking dialog: opens immediately so the merchant sees the provider
 * and an in-progress spinner while MyParcel Asia answers, then the response's
 * tracking numbers or errors.
 */
export function AwbModal({ busy, result, error, onClose }: Props) {
  const integrationName = result?.integrationName?.trim();
  return (
    <div className="pd-modal" role="presentation" onClick={() => !busy && onClose()}>
      <div
        className="pd-modal__panel awb"
        role="dialog"
        aria-modal="true"
        aria-labelledby="awb-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="pd-modal__head">
          <h2 id="awb-title">Generate AWB</h2>
          <button
            type="button"
            className="pd-modal__close"
            aria-label="Close"
            onClick={onClose}
            disabled={busy}
          >
            <Icon name="close" size={15} />
          </button>
        </header>

        <div className="pd-modal__body">
          <div className="awb__integration">
            <span>Integration</span>
            <strong>
              MyParcel Asia
              {integrationName ? <span className="awb__account"> · {integrationName}</span> : null}
            </strong>
          </div>

          {busy ? (
            <div className="awb__busy" role="status">
              <span className="awb__spinner" aria-hidden="true" />
              <div>
                <strong>In Progress</strong>
                <p>Booking the selected shipments with MyParcel Asia…</p>
              </div>
            </div>
          ) : error ? (
            <p className="awb__error" role="alert">
              {error}
            </p>
          ) : result ? (
            <>
              <p className={result.ok ? "awb__ok" : "awb__error"} role="status">
                {result.ok
                  ? `${result.shipments.length} AWB${result.shipments.length === 1 ? "" : "s"} generated.`
                  : "The AWB request finished with issues."}
              </p>

              {result.messages.length > 0 ? (
                <ul className="awb__messages">
                  {result.messages.map((message, index) => (
                    <li key={`${index}-${message}`}>{message}</li>
                  ))}
                </ul>
              ) : null}

              {result.shipments.length > 0 ? (
                <div className="awb__list">
                  {result.shipments.map((shipment) => (
                    <div className="awb__row" key={shipment.orderId}>
                      <span>{shipment.orderNo}</span>
                      <span className={shipment.trackingNo ? "awb__tracking" : "awb__pending"}>
                        {shipment.trackingNo ?? "Tracking pending"}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}

          <div className="pd-modal__actions">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
