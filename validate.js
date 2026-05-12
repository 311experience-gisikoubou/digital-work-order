// ============================================================
//  バリデーション
// ============================================================
function validate(data) {
  const errors = [];
  if (!data.clinicName)   errors.push('歯科医院名');
  if (!data.doctorName)   errors.push('担当歯科医師');
  if (!data.patientName)  errors.push('患者名');

  if (!data.deliveryDate) errors.push('納期');
  return errors;
}
