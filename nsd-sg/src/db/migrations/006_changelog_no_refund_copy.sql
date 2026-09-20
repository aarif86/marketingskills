-- Customer-facing copy: no refund promise. Reword the 0.5.4 changelog row already seeded on live.
UPDATE changelog SET title = 'Payments show up in your history reliably',
  body = '- Fixed: HitPay payment notifications are now matched to your subscription every time, so each charge appears in your Plan & billing history.'
WHERE id = 'cl-0-5-4';
