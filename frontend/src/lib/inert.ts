/**
 * Tam ekran katmanlar (Şimdi çalıyor, etiket düzenleyici) açıkken uygulamanın geri kalanı erişilemez
 * olur. Sayaçlı: iç içe iki katmandan biri kapanınca diğeri hâlâ açıksa arka plan kilitli kalır.
 */
let count = 0;

export function lockBackground(): () => void {
  const root = document.getElementById('root');
  count++;
  root?.setAttribute('inert', '');
  let released = false;
  return () => {
    if (released) return;
    released = true;
    count = Math.max(0, count - 1);
    if (count === 0) root?.removeAttribute('inert');
  };
}
