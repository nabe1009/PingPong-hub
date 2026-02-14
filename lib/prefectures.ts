/** 都道府県を北（北海道）から南（沖縄県）の順に並べたリスト（JIS X 0401 相当） */
export const PREFECTURES_NORTH_TO_SOUTH = [
  "北海道",
  "青森県",
  "岩手県",
  "宮城県",
  "秋田県",
  "山形県",
  "福島県",
  "茨城県",
  "栃木県",
  "群馬県",
  "埼玉県",
  "千葉県",
  "東京都",
  "神奈川県",
  "新潟県",
  "富山県",
  "石川県",
  "福井県",
  "山梨県",
  "長野県",
  "岐阜県",
  "静岡県",
  "愛知県",
  "三重県",
  "滋賀県",
  "京都府",
  "大阪府",
  "兵庫県",
  "奈良県",
  "和歌山県",
  "鳥取県",
  "島根県",
  "岡山県",
  "広島県",
  "山口県",
  "徳島県",
  "香川県",
  "愛媛県",
  "高知県",
  "福岡県",
  "佐賀県",
  "長崎県",
  "熊本県",
  "大分県",
  "宮崎県",
  "鹿児島県",
  "沖縄県",
] as const;

const orderMap = new Map(PREFECTURES_NORTH_TO_SOUTH.map((p, i) => [p, i]));

/**
 * 都道府県名の配列を北から南の順にソートする。
 * リストにない名称は末尾に回す。
 */
export function sortPrefecturesNorthToSouth(prefectures: string[]): string[] {
  return [...prefectures].sort((a, b) => {
    const ia = orderMap.get(a) ?? 999;
    const ib = orderMap.get(b) ?? 999;
    if (ia !== ib) return ia - ib;
    return a.localeCompare(b, "ja");
  });
}
