function escapeHtml(str: string) {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function buildEmailHtml(params: {
  orderNumber: string;
  customerEmail: string;
  createdPlates: Array<{ slug: string; publicUrl: string; reviewUrl: string }>;
  publicBaseUrl: string;
}) {
  const { orderNumber, customerEmail, createdPlates, publicBaseUrl } = params;
  const createdAt = new Date().toLocaleString("fr-FR", {
    timeZone: "Europe/Paris",
  });

  const rows = createdPlates
    .map((p, idx) => {
      const absolutePublic = publicBaseUrl
        ? `${publicBaseUrl}${p.publicUrl}`
        : p.publicUrl;
      const href = absolutePublic;
      const label = escapeHtml(absolutePublic);

      return `
        <tr>
          <td style="padding:12px 10px; border-bottom:1px solid #eee; font-family: Arial, sans-serif; font-size:14px; color:#111;">
            ${idx + 1}
          </td>
          <td style="padding:12px 10px; border-bottom:1px solid #eee; font-family: Arial, sans-serif; font-size:14px;">
            <span>ID: ${escapeHtml(p.slug)}</span><br/>
           
          </td>
          <td style="padding:12px 10px; border-bottom:1px solid #eee; font-family: Arial, sans-serif; font-size:14px;">
            <a href="${href}" style="color:#0b57d0; text-decoration:none;">${label}</a>
          </td>
        </tr>
      `;
    })
    .join("");

  return `
  <div style="background:#f6f7f9; padding:24px;">
    <div style="max-width:720px; margin:0 auto; background:#ffffff; border-radius:12px; overflow:hidden; border:1px solid #e9e9e9;">
      <div style="padding:18px 22px; background:#111827; color:#ffffff; font-family: Arial, sans-serif;">
        <div style="font-size:16px; font-weight:700;">Nouvelles plaques NFC à configurer</div>
        <div style="font-size:13px; opacity:.85; margin-top:4px;">Commande ${escapeHtml(
          orderNumber
        )} • ${escapeHtml(createdAt)}</div>
      </div>

      <div style="padding:18px 22px; font-family: Arial, sans-serif;">
        <p style="margin:0 0 10px; font-size:14px; color:#111;">
          De nouvelle(s) plaque(s) (<strong>${
            createdPlates.length
          }</strong>) ont été générée(s) suite à un paiement Shopify.
        </p>

        <div style="margin:14px 0; padding:12px 14px; border:1px solid #eee; border-radius:10px; background:#fafafa;">
          <div style="font-size:13px; color:#444; line-height:1.5;">
            <div><strong>Commande :</strong> ${escapeHtml(orderNumber)}</div>
            <div><strong>Client :</strong> ${escapeHtml(customerEmail)}</div>
            <div><strong>Nombre de plaques :</strong> ${
              createdPlates.length
            }</div>
          </div>
        </div>

        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; margin-top:10px;">
          <thead>
            <tr>
              <th align="left" style="padding:10px; border-bottom:1px solid #ddd; font-family: Arial, sans-serif; font-size:12px; color:#555;">#</th>
              <th align="left" style="padding:10px; border-bottom:1px solid #ddd; font-family: Arial, sans-serif; font-size:12px; color:#555;">Plaque</th>
              <th align="left" style="padding:10px; border-bottom:1px solid #ddd; font-family: Arial, sans-serif; font-size:12px; color:#555;">Lien</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>

        <p style="margin:16px 0 0; font-size:12px; color:#666; line-height:1.4;">
          Si vous recevez ce message plusieurs fois, cela peut être dû à un retry Shopify — le système reste safe (aucune plaque n'a été dupliquée).
        </p>
      </div>
    </div>
  </div>
  `;
}
