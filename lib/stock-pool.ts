import { MARKET_CAP_EXPANSION_POOL } from "@/lib/stock-pool-expanded"

/**
 * A 股横截面计算用的股票池。
 * 选 HS300/中证 500 中市值、流动性和行业覆盖较好的 100+ 只股，
 * 作为因子计算、策略回测和雷达扫描的统一截面。
 *
 * 历史 K 线通过数据层分批预热到数据库。页面计算默认优先使用数据库，
 * 避免一次性把整个股票池的缺口都压到 Qveris。
 */
export type StockPoolItem = {
  symbol: string         // 标准 6 位代码
  symbolQveris: string   // 带交易所后缀，Qveris/akshare/tushare 通用
  name: string
  industry: string
}

export const STOCK_POOL_TARGET_SIZE = 500

type Exchange = "SH" | "SZ"

function stock(symbol: string, exchange: Exchange, name: string, industry: string): StockPoolItem {
  return {
    symbol,
    symbolQveris: `${symbol}.${exchange}`,
    name,
    industry,
  }
}

const CORE_STOCK_POOL: StockPoolItem[] = [
  stock("600519", "SH", "贵州茅台", "白酒"),
  stock("601318", "SH", "中国平安", "保险"),
  stock("600036", "SH", "招商银行", "银行"),
  stock("000858", "SZ", "五粮液", "白酒"),
  stock("300750", "SZ", "宁德时代", "电池"),
  stock("002594", "SZ", "比亚迪", "新能源车"),
  stock("600900", "SH", "长江电力", "电力"),
  stock("000333", "SZ", "美的集团", "家电"),
  stock("601012", "SH", "隆基绿能", "光伏"),
  stock("600276", "SH", "恒瑞医药", "医药"),

  stock("601398", "SH", "工商银行", "银行"),
  stock("601288", "SH", "农业银行", "银行"),
  stock("601988", "SH", "中国银行", "银行"),
  stock("601939", "SH", "建设银行", "银行"),
  stock("601328", "SH", "交通银行", "银行"),
  stock("601166", "SH", "兴业银行", "银行"),
  stock("600000", "SH", "浦发银行", "银行"),
  stock("600016", "SH", "民生银行", "银行"),
  stock("600919", "SH", "江苏银行", "银行"),
  stock("000001", "SZ", "平安银行", "银行"),

  stock("600030", "SH", "中信证券", "证券"),
  stock("601688", "SH", "华泰证券", "证券"),
  stock("601211", "SH", "国泰君安", "证券"),
  stock("600837", "SH", "海通证券", "证券"),
  stock("300059", "SZ", "东方财富", "金融科技"),
  stock("601601", "SH", "中国太保", "保险"),
  stock("601628", "SH", "中国人寿", "保险"),
  stock("601336", "SH", "新华保险", "保险"),
  stock("601319", "SH", "中国人保", "保险"),
  stock("000776", "SZ", "广发证券", "证券"),

  stock("600887", "SH", "伊利股份", "食品饮料"),
  stock("000568", "SZ", "泸州老窖", "白酒"),
  stock("600809", "SH", "山西汾酒", "白酒"),
  stock("000596", "SZ", "古井贡酒", "白酒"),
  stock("002304", "SZ", "洋河股份", "白酒"),
  stock("603288", "SH", "海天味业", "调味品"),
  stock("600690", "SH", "海尔智家", "家电"),
  stock("000651", "SZ", "格力电器", "家电"),
  stock("002027", "SZ", "分众传媒", "传媒"),
  stock("601888", "SH", "中国中免", "旅游零售"),

  stock("300760", "SZ", "迈瑞医疗", "医疗器械"),
  stock("300015", "SZ", "爱尔眼科", "医疗服务"),
  stock("000661", "SZ", "长春高新", "生物医药"),
  stock("603259", "SH", "药明康德", "医药服务"),
  stock("300759", "SZ", "康龙化成", "医药服务"),
  stock("600436", "SH", "片仔癀", "中药"),
  stock("600085", "SH", "同仁堂", "中药"),
  stock("600332", "SH", "白云山", "医药"),
  stock("300122", "SZ", "智飞生物", "疫苗"),
  stock("300347", "SZ", "泰格医药", "医药服务"),

  stock("000063", "SZ", "中兴通讯", "通信设备"),
  stock("000725", "SZ", "京东方A", "面板"),
  stock("002415", "SZ", "海康威视", "安防"),
  stock("002475", "SZ", "立讯精密", "消费电子"),
  stock("002241", "SZ", "歌尔股份", "消费电子"),
  stock("000977", "SZ", "浪潮信息", "AI算力"),
  stock("688981", "SH", "中芯国际", "半导体"),
  stock("688111", "SH", "金山办公", "软件"),
  stock("688012", "SH", "中微公司", "半导体设备"),
  stock("603986", "SH", "兆易创新", "半导体"),

  stock("002371", "SZ", "北方华创", "半导体设备"),
  stock("300124", "SZ", "汇川技术", "工业自动化"),
  stock("300782", "SZ", "卓胜微", "半导体"),
  stock("002049", "SZ", "紫光国微", "半导体"),
  stock("600745", "SH", "闻泰科技", "半导体"),
  stock("688008", "SH", "澜起科技", "半导体"),
  stock("688599", "SH", "天合光能", "光伏"),
  stock("600406", "SH", "国电南瑞", "电网设备"),
  stock("002230", "SZ", "科大讯飞", "人工智能"),
  stock("601138", "SH", "工业富联", "电子制造"),

  stock("300274", "SZ", "阳光电源", "逆变器"),
  stock("300014", "SZ", "亿纬锂能", "电池"),
  stock("002812", "SZ", "恩捷股份", "电池材料"),
  stock("603799", "SH", "华友钴业", "新能源材料"),
  stock("002460", "SZ", "赣锋锂业", "锂矿"),
  stock("002466", "SZ", "天齐锂业", "锂矿"),
  stock("600438", "SH", "通威股份", "光伏"),
  stock("002459", "SZ", "晶澳科技", "光伏"),
  stock("688223", "SH", "晶科能源", "光伏"),
  stock("300450", "SZ", "先导智能", "电池设备"),

  stock("601857", "SH", "中国石油", "油气"),
  stock("600028", "SH", "中国石化", "油气"),
  stock("600938", "SH", "中国海油", "油气"),
  stock("601088", "SH", "中国神华", "煤炭"),
  stock("601225", "SH", "陕西煤业", "煤炭"),
  stock("601899", "SH", "紫金矿业", "有色金属"),
  stock("600547", "SH", "山东黄金", "贵金属"),
  stock("600309", "SH", "万华化学", "化工"),
  stock("600019", "SH", "宝钢股份", "钢铁"),
  stock("601600", "SH", "中国铝业", "有色金属"),

  stock("000792", "SZ", "盐湖股份", "盐湖提锂"),
  stock("000807", "SZ", "云铝股份", "有色金属"),
  stock("600585", "SH", "海螺水泥", "建材"),
  stock("600176", "SH", "中国巨石", "玻纤"),
  stock("000830", "SZ", "鲁西化工", "化工"),
  stock("002601", "SZ", "龙佰集团", "钛白粉"),
  stock("600426", "SH", "华鲁恒升", "化工"),
  stock("002493", "SZ", "荣盛石化", "石化"),
  stock("600346", "SH", "恒力石化", "石化"),
  stock("000301", "SZ", "东方盛虹", "石化"),

  stock("601668", "SH", "中国建筑", "建筑"),
  stock("601390", "SH", "中国中铁", "建筑"),
  stock("601186", "SH", "中国铁建", "建筑"),
  stock("601800", "SH", "中国交建", "建筑"),
  stock("601766", "SH", "中国中车", "轨交装备"),
  stock("600018", "SH", "上港集团", "港口"),
  stock("601919", "SH", "中远海控", "航运"),
  stock("600009", "SH", "上海机场", "机场"),
  stock("600029", "SH", "南方航空", "航空"),
  stock("601111", "SH", "中国国航", "航空"),

  stock("600893", "SH", "航发动力", "军工"),
  stock("600760", "SH", "中航沈飞", "军工"),
  stock("000768", "SZ", "中航西飞", "军工"),
  stock("600150", "SH", "中国船舶", "船舶制造"),
  stock("601989", "SH", "中国重工", "船舶制造"),
  stock("601985", "SH", "中国核电", "电力"),
  stock("600905", "SH", "三峡能源", "新能源电力"),
  stock("600886", "SH", "国投电力", "电力"),
  stock("600011", "SH", "华能国际", "电力"),
  stock("600025", "SH", "华能水电", "电力"),

  stock("600795", "SH", "国电电力", "电力"),
  stock("000002", "SZ", "万科A", "房地产"),
  stock("001979", "SZ", "招商蛇口", "房地产"),
  stock("601669", "SH", "中国电建", "建筑"),
  stock("601618", "SH", "中国中冶", "建筑"),
  stock("600031", "SH", "三一重工", "工程机械"),
  stock("000157", "SZ", "中联重科", "工程机械"),
  stock("000425", "SZ", "徐工机械", "工程机械"),
  stock("603501", "SH", "韦尔股份", "半导体"),
  stock("688036", "SH", "传音控股", "消费电子"),
]

const INACTIVE_SYMBOLS = new Set([
  "600837", // 海通证券，2025-03 主动终止上市并换股并入国泰君安。
  "601989", // 中国重工，2025 换股吸收合并进入停牌/终止上市流程，Qveris 无后续日线。
])

export const STOCK_POOL: StockPoolItem[] = dedupeStockPool([
  ...CORE_STOCK_POOL,
  ...MARKET_CAP_EXPANSION_POOL,
])
  .filter((stock) => !INACTIVE_SYMBOLS.has(stock.symbol))
  .slice(0, STOCK_POOL_TARGET_SIZE)

export function findStock(symbol: string): StockPoolItem | undefined {
  return STOCK_POOL.find((s) => s.symbol === symbol || s.symbolQveris === symbol)
}

function dedupeStockPool(pool: StockPoolItem[]) {
  const bySymbol = new Map<string, StockPoolItem>()
  for (const item of pool) {
    if (!bySymbol.has(item.symbol)) bySymbol.set(item.symbol, item)
  }
  return Array.from(bySymbol.values())
}
