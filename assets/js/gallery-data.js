/* =========================================================
   Phoebe 小星球 — 相簿資料
   想新增照片時，只要在這個清單裡多加一筆就好。
   欄位說明：
   - src      照片路徑（相對於網站根目錄；放進 photos/ 也可以）
   - title    照片標題
   - meta     右下角的小字（地點、日期、作者都可以）
   - category travel（旅行） / cosplay（名畫 cosplay） / daily（日常）
   - demo     是否是網站內建的示範插圖（true / false）
   - alt      圖片替代文字（給螢幕閱讀器與 SEO）
   - position 選填，CSS object-position，例如 "center 30%"
   - thumb    選填，相簿卡片用的縮圖（沒有就載入 src）
   - portrait 選填，直式照片設 true，卡片會用 3:4 比例顯示
   ========================================================= */
window.PHOEBE_GALLERY = {
  // 把真實照片換好之後，改成 false 就不會顯示「示範圖」小標
  showDemoBadges: false,

  categories: [
    { id: "all", label: "全部", emoji: "✦" },
    { id: "travel", label: "旅行", emoji: "✈️" },
    { id: "cosplay", label: "名畫 cosplay", emoji: "🖼️" },
    { id: "daily", label: "日常", emoji: "☁️" }
  ],

  items: [
    {
      src: "assets/img/gallery/travel-tokyo.jpg",
      title: "櫻花季的東京",
      meta: "東京 · 目黑川 · 春天",
      category: "travel",
      demo: true,
      alt: "Phoebe 站在櫻花樹下，背景是東京的紅色鳥居"
    },
    {
      src: "assets/img/gallery/travel-paris.jpg",
      title: "巴黎的黃昏",
      meta: "巴黎 · 塞納河畔 · 秋天",
      category: "travel",
      demo: true,
      alt: "Phoebe 在巴黎艾菲爾鐵塔前的黃昏景色裡"
    },
    {
      src: "assets/img/gallery/travel-fuji.jpg",
      title: "富士山下的晴天",
      meta: "河口湖 · 山梨 · 冬天",
      category: "travel",
      demo: true,
      alt: "Phoebe 在藍天與積雪富士山前的合照"
    },
    {
      src: "assets/img/gallery/travel-okinawa.jpg",
      title: "沖繩的海風",
      meta: "沖繩 · 古宇利島 · 夏天",
      category: "travel",
      demo: true,
      alt: "Phoebe 在沖繩沙灘上，背景是藍綠色的大海與棕櫚樹"
    },
    {
      src: "assets/img/gallery/travel-taipei.jpg",
      title: "台北的燈籠夜",
      meta: "台北 · 迪化街 · 冬夜",
      category: "travel",
      demo: true,
      alt: "Phoebe 在台北夜晚的燈籠街道上，背景是城市燈火"
    },
    {
      src: "assets/img/gallery/travel-alps.jpg",
      title: "阿爾卑斯的初雪",
      meta: "瑞士 · 少女峰 · 初冬",
      category: "travel",
      demo: true,
      alt: "Phoebe 在阿爾卑斯雪山與雪松之間"
    },
    {
      src: "photos/cosplay/napoleon-alps.jpg",
      thumb: "photos/cosplay/thumbs/napoleon-alps.jpg",
      portrait: true,
      title: "拿破菲比",
      meta: "大衛《跨越阿爾卑斯山的拿破崙》· 1801",
      category: "cosplay",
      demo: false,
      alt: "Phoebe 扮成拿破崙，騎著白馬、披著紅色披風跨越阿爾卑斯山"
    },
    {
      src: "photos/cosplay/mona-lisa.jpg",
      thumb: "photos/cosplay/thumbs/mona-lisa.jpg",
      portrait: true,
      title: "蒙娜菲比",
      meta: "達文西《蒙娜麗莎》· 1503",
      category: "cosplay",
      demo: false,
      alt: "Phoebe 扮成蒙娜麗莎，穿著深色長袍、背景是文藝復興風景"
    },
    {
      src: "photos/cosplay/girl-with-pearl-earring.jpg",
      thumb: "photos/cosplay/thumbs/girl-with-pearl-earring.jpg",
      portrait: true,
      title: "戴珍珠耳環的菲比",
      meta: "維梅爾《戴珍珠耳環的少女》· 1665",
      category: "cosplay",
      demo: false,
      alt: "Phoebe 扮成戴珍珠耳環的少女，藍色頭巾、深色背景與珍珠耳環"
    },
    {
      src: "photos/cosplay/van-gogh-hat.jpg",
      thumb: "photos/cosplay/thumbs/van-gogh-hat.jpg",
      portrait: true,
      title: "菲比的草帽",
      meta: "梵谷《草帽自畫像》· 1887",
      category: "cosplay",
      demo: false,
      alt: "Phoebe 戴著草帽、藍色領巾，以梵谷厚塗筆觸畫成的自畫像風格"
    },
    {
      src: "assets/img/gallery/cosplay-starry-night.jpg",
      title: "菲比的星夜",
      meta: "梵谷《星夜》· 1889",
      category: "cosplay",
      demo: true,
      alt: "Phoebe 扮成梵谷星夜裡的主角，周圍是藍色漩渦星空"
    },
    {
      src: "assets/img/gallery/cosplay-scream.jpg",
      title: "菲比的吶喊",
      meta: "孟克《吶喊》· 1893",
      category: "cosplay",
      demo: true,
      alt: "Phoebe 站在孟克吶喊的橘色波浪天空與橋上"
    },
    {
      src: "assets/img/gallery/cosplay-mona-lisa.jpg",
      title: "蒙娜菲比（插畫版）",
      meta: "達文西《蒙娜麗莎》· 1503",
      category: "cosplay",
      demo: true,
      alt: "Phoebe 扮成蒙娜麗莎，背景是文藝復興風格的風景"
    },
    {
      src: "assets/img/gallery/cosplay-sunflowers.jpg",
      title: "菲比的向日葵",
      meta: "梵谷《向日葵》· 1888",
      category: "cosplay",
      demo: true,
      alt: "Phoebe 在梵谷向日葵畫作的暖黃色背景前"
    },
    {
      src: "assets/img/gallery/cosplay-pearl.jpg",
      title: "戴珍珠耳環的菲比（插畫版）",
      meta: "維梅爾《戴珍珠耳環的少女》· 1665",
      category: "cosplay",
      demo: true,
      alt: "Phoebe 扮成戴珍珠耳環的少女，深色背景與藍色頭巾"
    },
    {
      src: "assets/img/gallery/daily-cafe.jpg",
      title: "下午的咖啡廳",
      meta: "日常 · 甜點時間",
      category: "daily",
      demo: true,
      alt: "Phoebe 在咖啡廳裡，桌上有拉花咖啡與蛋糕"
    },
    {
      src: "assets/img/gallery/daily-books.jpg",
      title: "書櫃前的小時光",
      meta: "日常 · 閱讀",
      category: "daily",
      demo: true,
      alt: "Phoebe 站在擺滿彩色書本的書櫃前"
    },
    {
      src: "assets/img/gallery/daily-rain.jpg",
      title: "下雨天的窗邊",
      meta: "日常 · 雨天",
      category: "daily",
      demo: true,
      alt: "Phoebe 在雨天的窗邊，窗外是模糊的城市"
    },
    {
      src: "assets/img/gallery/daily-birthday.jpg",
      title: "生日派對！",
      meta: "日常 · 慶生",
      category: "daily",
      demo: true,
      alt: "Phoebe 在生日派對上，有氣球、彩旗和蛋糕"
    }
  ]
};
