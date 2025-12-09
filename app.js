// app.js

const { createApp } = Vue;

let googleMap = null;
let googleMarker = null;

window.initGoogleMaps = function () {
  // Google 會在載完 JS 後呼叫這個
  console.log("Google Maps SDK loaded");
};

const app = createApp({
  data() {
    return {
      // --------------- UI / Tab ---------------
      tabs: [
        { id: "daily", name: "每日行程總覽" },
        { id: "transport", name: "機票/車票" },
        { id: "itinerary", name: "行程規劃" },
        { id: "accommodation", name: "入住資料" },
        { id: "checklist", name: "必備物品清單" },
        { id: "expense", name: "記帳功能" },
      ],
      activeTab: "daily",

      // PWA 安裝
      showInstallButton: false,
      deferredPrompt: null,

      // --------------- 多人同步狀態 ---------------
      isLoadingFromCloud: true,
      isSavingToCloud: false,

      // --------------- 行程日期 / 每日行程 ---------------
      tripStartDate: null, // "2025-03-10"
      tripEndDate: null,   // "2025-03-16"
      selectedDayNumber: 1,

      // --------------- 交通 ---------------
      transports: [],
      newTransport: {
        type: "",
        from: "",
        to: "",
        date: "",
        departureTime: "",
        arrivalTime: "",
        notes: "",
      },

      // --------------- 行程 ---------------
      itineraries: [],
      newItinerary: {
        date: "",
        time: "",
        location: "",
        address: "",
        lat: "",
        lng: "",
        fromItineraryId: "",
        description: "",
        routeInfo: null,
      },
      showSuggestions: false,
      placeSuggestions: [],
      // 這個只是 demo 用，實際上你可以接 Places API
      placeSearchTimeout: null,

      // --------------- 住宿 ---------------
      accommodations: [],
      newAccommodation: {
        name: "",
        checkIn: "",
        checkOut: "",
        address: "",
        phone: "",
        roomNumber: "",
        notes: "",
      },

      // --------------- 必備物品 ---------------
      checklistItems: [],
      newChecklistItem: {
        name: "",
        person1Checked: false,
        person2Checked: false,
      },
      person1Name: "",
      person2Name: "",

      // --------------- 記帳 ---------------
      exchangeRate: 0.025,
      expenses: [],
      newExpense: {
        type: "",
        amount: null,
        category: "",
        date: "",
        time: "",
        notes: "",
      },

      // --------------- 地圖 modal ---------------
      showMapModal: false,
      currentLocationName: "",
      routeInfo: null,
    };
  },

  computed: {
    // ----------------- 每日行程相關 -----------------
    tripDays() {
      if (!this.tripStartDate || !this.tripEndDate) return [];

      const days = [];
      const start = new Date(this.tripStartDate);
      const end = new Date(this.tripEndDate);

      let cur = new Date(start);
      let idx = 1;
      while (cur <= end) {
        const dateStr = cur.toISOString().slice(0, 10);
        days.push({
          dayNumber: idx,
          date: dateStr,
          label: `Day${idx}`,
        });
        idx++;
        cur.setDate(cur.getDate() + 1);
      }
      return days;
    },

    currentDayInfo() {
      return this.tripDays.find(
        (d) => d.dayNumber === this.selectedDayNumber
      ) || null;
    },

    dailySchedule() {
      if (!this.currentDayInfo) return [];

      const date = this.currentDayInfo.date;

      const items = [];

      // 交通
      this.transports
        .filter((t) => t.date === date)
        .forEach((t) => {
          items.push({
            type: "交通",
            time: t.departureTime || "--:--",
            title: `${t.type}：${t.from} → ${t.to}`,
            details: `時間：${t.departureTime} - ${t.arrivalTime}${
              t.notes ? "｜備註：" + t.notes : ""
            }`,
            color: "#4a90e2",
            locationData: null,
          });
        });

      // 行程
      this.itineraries
        .filter((it) => it.date === date)
        .forEach((it) => {
          items.push({
            type: "行程",
            time: it.time || "--:--",
            title: it.location,
            details: it.description || "",
            color: "#27ae60",
            locationData: {
              lat: it.lat ? Number(it.lat) : null,
              lng: it.lng ? Number(it.lng) : null,
            },
          });
        });

      // 住宿（顯示入住 / 退房）
      this.accommodations.forEach((a) => {
        if (a.checkIn === date) {
          items.push({
            type: "住宿",
            time: "入住",
            title: `${a.name}（入住）`,
            details: a.address || "",
            color: "#f39c12",
            locationData: null,
          });
        }
        if (a.checkOut === date) {
          items.push({
            type: "住宿",
            time: "退房",
            title: `${a.name}（退房）`,
            details: a.address || "",
            color: "#f39c12",
            locationData: null,
          });
        }
      });

      // 依時間排序
      items.sort((a, b) => (a.time || "").localeCompare(b.time || ""));
      return items;
    },

    // 行程排序列表
    sortedItineraries() {
      return [...this.itineraries].sort((a, b) => {
        const ad = `${a.date || ""} ${a.time || ""}`;
        const bd = `${b.date || ""} ${b.time || ""}`;
        return ad.localeCompare(bd);
      });
    },

    // 行程下拉：可當作「上一個行程」的候選
    availablePreviousItineraries() {
      return this.sortedItineraries.map((it, index) => ({
        ...it,
        originalIndex: index,
      }));
    },

    // ----------------- 記帳統計 -----------------
    totalIncome() {
      return this.expenses
        .filter((e) => e.type === "income")
        .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    },
    totalExpense() {
      return this.expenses
        .filter((e) => e.type === "expense")
        .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    },
    balance() {
      return this.totalIncome - this.totalExpense;
    },
    totalIncomeTWD() {
      return this.convertToTWD(this.totalIncome);
    },
    totalExpenseTWD() {
      return this.convertToTWD(this.totalExpense);
    },
    balanceTWD() {
      return this.convertToTWD(this.balance);
    },

    sortedExpenses() {
      return [...this.expenses].sort((a, b) => {
        const ad = `${a.date || ""} ${a.time || ""}`;
        const bd = `${b.date || ""} ${b.time || ""}`;
        return ad.localeCompare(bd);
      });
    },
  },

  watch: {
    // 任何資料改變就同步到 Firestore
    transports: {
      deep: true,
      handler() {
        this.updateTripDateRange();
        this.saveToFirestore();
      },
    },
    itineraries: {
      deep: true,
      handler() {
        this.updateTripDateRange();
        this.saveToFirestore();
      },
    },
    accommodations: {
      deep: true,
      handler() {
        this.updateTripDateRange();
        this.saveToFirestore();
      },
    },
    checklistItems: {
      deep: true,
      handler() {
        this.saveToFirestore();
      },
    },
    expenses: {
      deep: true,
      handler() {
        this.saveToFirestore();
      },
    },
    person1Name() {
      this.saveToFirestore();
    },
    person2Name() {
      this.saveToFirestore();
    },
    exchangeRate() {
      this.saveToFirestore();
    },
    tripStartDate() {
      this.saveToFirestore();
    },
    tripEndDate() {
      this.saveToFirestore();
    },
  },

  methods: {
    // -------------- 日期格式 --------------
    formatDate(dateStr) {
      if (!dateStr) return "";
      const d = new Date(dateStr);
      if (isNaN(d)) return dateStr;
      return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(
        2,
        "0"
      )}/${String(d.getDate()).padStart(2, "0")}`;
    },
    formatDateRange(start, end) {
      if (!start || !end) return "尚未設定";
      return `${this.formatDate(start)} - ${this.formatDate(end)}`;
    },

    // 根據所有資料計算 tripStartDate / tripEndDate
    updateTripDateRange() {
      const dates = [];

      this.transports.forEach((t) => t.date && dates.push(t.date));
      this.itineraries.forEach((it) => it.date && dates.push(it.date));
      this.accommodations.forEach((a) => {
        a.checkIn && dates.push(a.checkIn);
        a.checkOut && dates.push(a.checkOut);
      });

      if (dates.length === 0) return;

      dates.sort();
      this.tripStartDate = dates[0];
      this.tripEndDate = dates[dates.length - 1];

      // 如果目前選擇天數超出範圍，重設為 1
      if (
        this.selectedDayNumber < 1 ||
        this.selectedDayNumber > this.tripDays.length
      ) {
        this.selectedDayNumber = 1;
      }
    },

    // -------------- PWA 安裝 --------------
    installApp() {
      if (!this.deferredPrompt) return;
      this.deferredPrompt.prompt();
      this.deferredPrompt.userChoice.finally(() => {
        this.deferredPrompt = null;
        this.showInstallButton = false;
      });
    },

    // -------------- localStorage 備份 --------------
    saveToLocalStorage() {
      const payload = {
        transports: this.transports,
        itineraries: this.itineraries,
        accommodations: this.accommodations,
        checklistItems: this.checklistItems,
        expenses: this.expenses,
        person1Name: this.person1Name,
        person2Name: this.person2Name,
        exchangeRate: this.exchangeRate,
        tripStartDate: this.tripStartDate,
        tripEndDate: this.tripEndDate,
      };
      localStorage.setItem("kr_trip_data", JSON.stringify(payload));
    },

    loadFromLocalStorage() {
      const raw = localStorage.getItem("kr_trip_data");
      if (!raw) return;
      try {
        const data = JSON.parse(raw);
        this.applyCloudOrLocalData(data);
      } catch (e) {
        console.error("解析 localStorage 失敗：", e);
      }
    },

    // -------------- Firestore 多人同步 --------------
    async loadFromFirestore() {
      try {
        if (!window.tripDocRef || !window.firebaseFns) {
          console.warn("Firestore 尚未初始化，改用 localStorage。");
          this.loadFromLocalStorage();
          this.isLoadingFromCloud = false;
          return;
        }

        const { getDoc, onSnapshot, setDoc } = window.firebaseFns;
        const docRef = window.tripDocRef;

        const snap = await getDoc(docRef);

        if (snap.exists()) {
          this.applyCloudOrLocalData(snap.data());
        } else {
          // 初次建立空文件
          await setDoc(docRef, {
            transports: [],
            itineraries: [],
            accommodations: [],
            checklistItems: [],
            expenses: [],
            person1Name: "",
            person2Name: "",
            exchangeRate: 0.025,
            tripStartDate: null,
            tripEndDate: null,
          });
        }

        // 監聽線上更新（別人修改會同步進來）
        onSnapshot(docRef, (snapshot) => {
          if (!snapshot.exists()) return;
          if (this.isSavingToCloud) return; // 避免自己剛寫入又被蓋掉
          this.applyCloudOrLocalData(snapshot.data());
        });
      } catch (err) {
        console.error("讀取 Firestore 失敗，改用 localStorage：", err);
        this.loadFromLocalStorage();
      } finally {
        this.isLoadingFromCloud = false;
      }
    },

    applyCloudOrLocalData(data) {
      this.transports = data.transports || [];
      this.itineraries = data.itineraries || [];
      this.accommodations = data.accommodations || [];
      this.checklistItems = data.checklistItems || [];
      this.expenses = data.expenses || [];
      this.person1Name = data.person1Name || "";
      this.person2Name = data.person2Name || "";
      this.exchangeRate =
        typeof data.exchangeRate === "number"
          ? data.exchangeRate
          : 0.025;
      this.tripStartDate = data.tripStartDate || null;
      this.tripEndDate = data.tripEndDate || null;

      this.updateTripDateRange();
    },

    async saveToFirestore() {
      // 先存 localStorage 當備份
      this.saveToLocalStorage();

      if (!window.tripDocRef || !window.firebaseFns) {
        return; // 沒有 Firestore 就只用 localStorage
      }

      try {
        this.isSavingToCloud = true;

        const { setDoc } = window.firebaseFns;
        const docRef = window.tripDocRef;

        const payload = {
          transports: this.transports,
          itineraries: this.itineraries,
          accommodations: this.accommodations,
          checklistItems: this.checklistItems,
          expenses: this.expenses,
          person1Name: this.person1Name,
          person2Name: this.person2Name,
          exchangeRate: this.exchangeRate,
          tripStartDate: this.tripStartDate || null,
          tripEndDate: this.tripEndDate || null,
        };

        await setDoc(docRef, payload, { merge: true });
      } catch (err) {
        console.error("寫入 Firestore 失敗：", err);
      } finally {
        this.isSavingToCloud = false;
      }
    },

    // -------------- 交通 CRUD --------------
    addTransport() {
      if (!this.newTransport.type || !this.newTransport.date) return;
      this.transports.push({ ...this.newTransport });
      this.newTransport = {
        type: "",
        from: "",
        to: "",
        date: "",
        departureTime: "",
        arrivalTime: "",
        notes: "",
      };
    },
    editTransport(index) {
      this.newTransport = { ...this.transports[index] };
      this.transports.splice(index, 1);
      this.activeTab = "transport";
    },
    deleteTransport(index) {
      this.transports.splice(index, 1);
    },

    // -------------- 行程 CRUD --------------
    addItinerary() {
      if (!this.newItinerary.date || !this.newItinerary.time || !this.newItinerary.location) return;
      this.itineraries.push({
        ...this.newItinerary,
        routeInfo: null,
      });
      this.newItinerary = {
        date: "",
        time: "",
        location: "",
        address: "",
        lat: "",
        lng: "",
        fromItineraryId: "",
        description: "",
        routeInfo: null,
      };
    },
    editItinerary(index) {
      this.newItinerary = { ...this.itineraries[index] };
      this.itineraries.splice(index, 1);
      this.activeTab = "itinerary";
    },
    deleteItinerary(index) {
      this.itineraries.splice(index, 1);
    },

    // 行程名稱（在路線資訊標題用）
    getItineraryName(idx) {
      const it = this.itineraries[idx];
      if (!it) return "";
      return `${it.date} ${it.time} ${it.location}`;
    },

    // Demo 的地點搜尋（不是 Google Places，只是佔位）
    searchPlaces() {
      if (this.placeSearchTimeout) {
        clearTimeout(this.placeSearchTimeout);
      }
      const keyword = this.newItinerary.location.trim();
      if (!keyword) {
        this.placeSuggestions = [];
        return;
      }
      this.placeSearchTimeout = setTimeout(() => {
        this.placeSuggestions = [
          {
            name: keyword,
            address: "自訂地址（可改成實際 Places API）",
            lat: "",
            lng: "",
          },
        ];
      }, 300);
    },
    selectPlace(suggestion) {
      this.newItinerary.location = suggestion.name;
      this.newItinerary.address = suggestion.address || "";
      this.newItinerary.lat = suggestion.lat || "";
      this.newItinerary.lng = suggestion.lng || "";
      this.placeSuggestions = [];
      this.showSuggestions = false;
    },

    quickSetRoute(index) {
      // 目前先不做實際路線計算，避免跟 Google Directions 再串一次
      alert("目前路線規劃是簡化版本，之後可以再一起強化 🚇");
    },

    showRouteBetween(fromId, indexOrObj) {
      alert("路線詳細規劃尚未串接，先顯示地圖即可。");
    },

    // -------------- 住宿 CRUD --------------
    addAccommodation() {
      if (!this.newAccommodation.name || !this.newAccommodation.checkIn || !this.newAccommodation.checkOut) return;
      this.accommodations.push({ ...this.newAccommodation });
      this.newAccommodation = {
        name: "",
        checkIn: "",
        checkOut: "",
        address: "",
        phone: "",
        roomNumber: "",
        notes: "",
      };
    },
    editAccommodation(index) {
      this.newAccommodation = { ...this.accommodations[index] };
      this.accommodations.splice(index, 1);
      this.activeTab = "accommodation";
    },
    deleteAccommodation(index) {
      this.accommodations.splice(index, 1);
    },

    // -------------- 必備物品 --------------
    addChecklistItem() {
      if (!this.newChecklistItem.name.trim()) return;
      this.checklistItems.push({
        name: this.newChecklistItem.name.trim(),
        person1Checked: false,
        person2Checked: false,
      });
      this.newChecklistItem.name = "";
    },
    toggleChecklistItem(index, who) {
      const item = this.checklistItems[index];
      if (!item) return;
      if (who === "person1") {
        item.person1Checked = !item.person1Checked;
      } else if (who === "person2") {
        item.person2Checked = !item.person2Checked;
      }
    },
    deleteChecklistItem(index) {
      this.checklistItems.splice(index, 1);
    },
    isItemCompleted(item) {
      return item.person1Checked && item.person2Checked;
    },
    getPersonCheckedCount(who) {
      return this.checklistItems.filter((item) =>
        who === "person1" ? item.person1Checked : item.person2Checked
      ).length;
    },
    getPersonCompletion(who) {
      if (this.checklistItems.length === 0) return 0;
      const count = this.getPersonCheckedCount(who);
      return Math.round((count / this.checklistItems.length) * 100);
    },

    // -------------- 記帳 --------------
    convertToTWD(amount) {
      return Math.round((Number(amount) || 0) * (Number(this.exchangeRate) || 0));
    },
    addExpense() {
      if (!this.newExpense.type || !this.newExpense.amount) return;
      this.expenses.push({ ...this.newExpense });
      this.newExpense = {
        type: "",
        amount: null,
        category: "",
        date: "",
        time: "",
        notes: "",
      };
    },
    editExpense(index) {
      this.newExpense = { ...this.expenses[index] };
      this.expenses.splice(index, 1);
      this.activeTab = "expense";
    },
    deleteExpense(index) {
      this.expenses.splice(index, 1);
    },

    // -------------- 地圖 --------------
    showMap(locationData) {
      if (!locationData || !locationData.lat || !locationData.lng) return;
      this.currentLocationName = locationData.location || this.currentDayInfo?.label || "位置";
      this.showMapModal = true;
      this.routeInfo = null;

      const lat = Number(locationData.lat);
      const lng = Number(locationData.lng);

      this.$nextTick(() => {
        const el = document.getElementById("map");
        if (!el || !window.google || !google.maps) return;

        if (!googleMap) {
          googleMap = new google.maps.Map(el, {
            center: { lat, lng },
            zoom: 15,
          });
        } else {
          googleMap.setCenter({ lat, lng });
          googleMap.setZoom(15);
        }

        if (googleMarker) {
          googleMarker.setMap(null);
        }
        googleMarker = new google.maps.Marker({
          position: { lat, lng },
          map: googleMap,
        });
      });
    },
    showRoute(locationData) {
      // 簡化版：先跟 showMap 一樣，只顯示位置
      this.showMap(locationData);
    },
    closeMapModal() {
      this.showMapModal = false;
      this.routeInfo = null;
    },
  },

  mounted() {
    // PWA 安裝提示
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      this.deferredPrompt = e;
      this.showInstallButton = true;
    });

    // Service Worker 註冊（PWA 快取）
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("./service-worker.js")
        .then(() => console.log("Service Worker registered"))
        .catch((err) => console.error("SW register failed", err));
    }

    // 先從 Firestore 讀資料（失敗就會自動 fallback localStorage）
    this.loadFromFirestore();
  },
});

app.mount("#app");
