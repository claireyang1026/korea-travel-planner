// app.js — Firebase 多人同步版

// 1. 匯入 Firebase (CDN 模組版)
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

// 2. 這裡貼上你在 Firebase Console 看到的 firebaseConfig
// ⚠️ 把下面這段換成「你自己的」那一段
const firebaseConfig = {
  apiKey: "AIzaSyBGgCKVVDF7AUcsd8VrisM3p6fWPIx1iow",
  authDomain: "korea-travel-planner.firebaseapp.com",
  projectId: "korea-travel-planner",
  storageBucket: "korea-travel-planner.firebasestorage.app",
  messagingSenderId: "408025232778",
  appId: "1:408025232778:web:ccd3e4746b2a654ec84473"
};

// 3. 初始化 Firebase & Firestore
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// Firestore 文件路徑（大家共用同一份）
const TRIP_DOC_REF = doc(db, "trips", "korea-shared-trip");

// 4. Google Maps 載入回呼（給 index.html 最後那個 &callback=initGoogleMaps 用）
window.googleMapsLoaded = false;
window.initGoogleMaps = function () {
  window.googleMapsLoaded = true;
  if (window.vueApp && typeof window.vueApp.initMap === "function") {
    setTimeout(() => {
      try {
        if (typeof google !== "undefined" && google.maps) {
          window.vueApp.initMap();
        }
      } catch (e) {
        console.error("呼叫 initMap 時發生錯誤:", e);
      }
    }, 200);
  }
};

// 5. Vue 應用程式
const { createApp } = Vue;

const app = createApp({
  data() {
    return {
      // 狀態
      activeTab: "transport",
      tabs: [
        { id: "daily", name: "每日行程總覽" },
        { id: "transport", name: "機票/車票" },
        { id: "itinerary", name: "行程規劃" },
        { id: "accommodation", name: "入住資料" },
        { id: "expense", name: "記帳功能" },
        { id: "checklist", name: "必備物品清單" }
      ],

      // 每日行程總覽
      selectedDate: new Date().toISOString().split("T")[0],
      selectedDayNumber: 1,

      // 匯率（1 韓元 = ? 台幣）
      exchangeRate: 0.025,

      // Google Maps 相關
      map: null,
      showMapModal: false,
      currentLocationName: "",
      currentLocation: null,
      currentMarker: null,
      placeSuggestions: [],
      showSuggestions: false,
      placesService: null,
      autocompleteService: null,
      directionsService: null,
      directionsRenderer: null,
      routeInfo: null,
      currentPosition: null, // 目前所在位置

      // 交通資料
      transports: [],
      newTransport: {
        type: "",
        from: "",
        to: "",
        date: "",
        departureTime: "",
        arrivalTime: "",
        notes: ""
      },
      editingTransportIndex: null,

      // 行程資料
      itineraries: [],
      newItinerary: {
        date: "",
        time: "",
        location: "",
        description: "",
        address: "",
        lat: "",
        lng: "",
        fromItineraryId: "",
        routeInfo: null
      },
      editingItineraryIndex: null,

      // 住宿資料
      accommodations: [],
      newAccommodation: {
        name: "",
        checkIn: "",
        checkOut: "",
        address: "",
        phone: "",
        roomNumber: "",
        notes: ""
      },
      editingAccommodationIndex: null,

      // 記帳資料
      expenses: [],
      newExpense: {
        type: "",
        amount: 0,
        category: "",
        date: "",
        time: "",
        notes: ""
      },
      editingExpenseIndex: null,

      // 必備物品清單
      checklistItems: [],
      newChecklistItem: {
        name: ""
      },
      person1Name: "人員 1",
      person2Name: "人員 2",

      // PWA 安裝提示
      showInstallButton: false,
      deferredPrompt: null,

      // Firestore 同步狀態
      db,
      isApplyingRemoteData: false // 避免 onSnapshot 更新時又觸發 save
    };
  },

  computed: {
    // 行程排序
    sortedItineraries() {
      return [...this.itineraries].sort((a, b) => {
        const dateCompare = a.date.localeCompare(b.date);
        if (dateCompare !== 0) return dateCompare;
        return a.time.localeCompare(b.time);
      });
    },

    // 可當作出發點的行程（有座標）
    availablePreviousItineraries() {
      return this.itineraries
        .map((it, idx) => ({ ...it, originalIndex: idx }))
        .filter((it, idx) => {
          if (!it.lat || !it.lng) return false;
          if (this.editingItineraryIndex !== null) {
            return idx !== this.editingItineraryIndex;
          }
          return true;
        });
    },

    // 記帳排序
    sortedExpenses() {
      return [...this.expenses].sort((a, b) => {
        const dateCompare = b.date.localeCompare(a.date);
        if (dateCompare !== 0) return dateCompare;
        return b.time.localeCompare(a.time);
      });
    },

    totalIncome() {
      return this.expenses
        .filter((e) => e.type === "income")
        .reduce((sum, e) => sum + e.amount, 0);
    },
    totalExpense() {
      return this.expenses
        .filter((e) => e.type === "expense")
        .reduce((sum, e) => sum + e.amount, 0);
    },
    balance() {
      return this.totalIncome - this.totalExpense;
    },
    totalIncomeTWD() {
      return Math.round(this.totalIncome * this.exchangeRate);
    },
    totalExpenseTWD() {
      return Math.round(this.totalExpense * this.exchangeRate);
    },
    balanceTWD() {
      return Math.round(this.balance * this.exchangeRate);
    },

    // 行程開始/結束日期
    tripStartDate() {
      const allDates = [];

      this.transports
        .filter((t) => t.type === "機票")
        .forEach((f) => allDates.push(f.date));

      this.itineraries.forEach((i) => {
        if (i.date) allDates.push(i.date);
      });

      this.accommodations.forEach((a) => {
        if (a.checkIn) allDates.push(a.checkIn);
        if (a.checkOut) allDates.push(a.checkOut);
      });

      if (allDates.length === 0) return null;
      return allDates.sort()[0];
    },

    tripEndDate() {
      const allDates = [];

      this.transports
        .filter((t) => t.type === "機票")
        .forEach((f) => allDates.push(f.date));

      this.itineraries.forEach((i) => {
        if (i.date) allDates.push(i.date);
      });

      this.accommodations.forEach((a) => {
        if (a.checkIn) allDates.push(a.checkIn);
        if (a.checkOut) allDates.push(a.checkOut);
      });

      if (allDates.length === 0) return null;

      const sortedDates = allDates.sort();
      return sortedDates[sortedDates.length - 1];
    },

    // 產生 Day1, Day2 ... 清單
    tripDays() {
      if (!this.tripStartDate || !this.tripEndDate) return [];

      const days = [];
      const startParts = this.tripStartDate.split("-");
      const endParts = this.tripEndDate.split("-");
      const start = new Date(
        parseInt(startParts[0]),
        parseInt(startParts[1]) - 1,
        parseInt(startParts[2])
      );
      const end = new Date(
        parseInt(endParts[0]),
        parseInt(endParts[1]) - 1,
        parseInt(endParts[2])
      );

      let currentDate = new Date(start);
      let dayNumber = 1;
      const endDateOnly = new Date(
        end.getFullYear(),
        end.getMonth(),
        end.getDate()
      );

      while (currentDate <= endDateOnly) {
        const year = currentDate.getFullYear();
        const month = String(currentDate.getMonth() + 1).padStart(2, "0");
        const day = String(currentDate.getDate()).padStart(2, "0");
        const dateStr = `${year}-${month}-${day}`;

        days.push({
          dayNumber,
          date: dateStr,
          label: `Day ${dayNumber}`
        });
        dayNumber++;

        currentDate = new Date(currentDate);
        currentDate.setDate(currentDate.getDate() + 1);
      }

      return days;
    },

    currentDayInfo() {
      return this.tripDays.find((d) => d.dayNumber === this.selectedDayNumber) || null;
    },

    // 每日行程總覽
    dailySchedule() {
      let targetDate = this.selectedDate;
      if (this.currentDayInfo) targetDate = this.currentDayInfo.date;

      const schedule = [];

      // 交通
      this.transports.forEach((transport) => {
        if (transport.date === targetDate) {
          schedule.push({
            time: transport.departureTime,
            title: `${transport.type}：${transport.from} → ${transport.to}`,
            type: "交通",
            details: `抵達時間：${transport.arrivalTime}`,
            extraInfo: transport.notes ? `備註：${transport.notes}` : null,
            color: "#3498db"
          });
        }
      });

      // 行程
      this.itineraries.forEach((itinerary) => {
        if (itinerary.date === targetDate) {
          const routeInfoText =
            itinerary.routeInfo && itinerary.routeInfo.length > 0
              ? `從 ${this.getItineraryName(itinerary.fromItineraryId)} 出發：${
                  itinerary.routeInfo[0].duration
                }（${itinerary.routeInfo[0].distance}）`
              : null;

          schedule.push({
            time: itinerary.time,
            title: itinerary.location,
            type: "行程",
            details: itinerary.description || null,
            extraInfo: routeInfoText,
            color: "#27ae60",
            locationData:
              itinerary.lat && itinerary.lng
                ? {
                    location: itinerary.location,
                    lat: itinerary.lat,
                    lng: itinerary.lng,
                    address: itinerary.address,
                    routeInfo: itinerary.routeInfo,
                    fromItineraryId: itinerary.fromItineraryId
                  }
                : null
          });
        }
      });

      // 住宿
      this.accommodations.forEach((a) => {
        if (a.checkIn === targetDate) {
          schedule.push({
            time: "14:00",
            title: `入住：${a.name}`,
            type: "住宿",
            details: a.address ? `地址：${a.address}` : null,
            extraInfo: a.roomNumber ? `房間：${a.roomNumber}` : null,
            color: "#e67e22"
          });
        }
        if (a.checkOut === targetDate) {
          schedule.push({
            time: "11:00",
            title: `退房：${a.name}`,
            type: "住宿",
            details: null,
            extraInfo: null,
            color: "#e67e22"
          });
        }
      });

      return schedule.sort((a, b) => a.time.localeCompare(b.time));
    }
  },

  methods: {
    // ====== Firestore 儲存 / 載入 ======
    async saveToFirestore() {
      if (!this.db || this.isApplyingRemoteData) return;

      const payload = {
        transports: this.transports,
        itineraries: this.itineraries,
        accommodations: this.accommodations,
        expenses: this.expenses,
        checklistItems: this.checklistItems,
        exchangeRate: this.exchangeRate,
        person1Name: this.person1Name,
        person2Name: this.person2Name
      };

      try {
        await setDoc(TRIP_DOC_REF, payload, { merge: true });
        // console.log("已儲存到 Firestore");
      } catch (err) {
        console.error("儲存到 Firestore 失敗:", err);
      }
    },

    async loadFromFirestoreAndListen() {
      try {
        // 先讀一次現有資料
        const snap = await getDoc(TRIP_DOC_REF);
        if (snap.exists()) {
          this.isApplyingRemoteData = true;
          const data = snap.data() || {};

          this.transports = data.transports || [];
          this.itineraries = data.itineraries || [];
          this.accommodations = data.accommodations || [];
          this.expenses = data.expenses || [];
          this.checklistItems = data.checklistItems || [];
          this.exchangeRate =
            typeof data.exchangeRate === "number" ? data.exchangeRate : 0.025;
          this.person1Name = data.person1Name || "人員 1";
          this.person2Name = data.person2Name || "人員 2";

          this.isApplyingRemoteData = false;
        } else {
          // 如果沒有資料，就建立一份空的
          await setDoc(TRIP_DOC_REF, {
            transports: [],
            itineraries: [],
            accommodations: [],
            expenses: [],
            checklistItems: [],
            exchangeRate: this.exchangeRate,
            person1Name: this.person1Name,
            person2Name: this.person2Name
          });
        }

        // 之後持續聽遠端變化（多人同步）
        onSnapshot(TRIP_DOC_REF, (snapshot) => {
          if (!snapshot.exists()) return;
          const data = snapshot.data() || {};
          this.isApplyingRemoteData = true;

          this.transports = data.transports || [];
          this.itineraries = data.itineraries || [];
          this.accommodations = data.accommodations || [];
          this.expenses = data.expenses || [];
          this.checklistItems = data.checklistItems || [];
          this.exchangeRate =
            typeof data.exchangeRate === "number" ? data.exchangeRate : 0.025;
          this.person1Name = data.person1Name || "人員 1";
          this.person2Name = data.person2Name || "人員 2";

          this.isApplyingRemoteData = false;
        });
      } catch (err) {
        console.error("讀取 Firestore 失敗:", err);
      }
    },

    // ====== 交通 ======
    addTransport() {
      if (this.editingTransportIndex !== null) {
        this.transports[this.editingTransportIndex] = { ...this.newTransport };
        this.editingTransportIndex = null;
      } else {
        this.transports.push({ ...this.newTransport });
      }
      this.resetTransportForm();
    },
    editTransport(index) {
      this.newTransport = { ...this.transports[index] };
      this.editingTransportIndex = index;
    },
    deleteTransport(index) {
      if (confirm("確定要刪除這筆記錄嗎？")) {
        this.transports.splice(index, 1);
      }
    },
    resetTransportForm() {
      this.newTransport = {
        type: "",
        from: "",
        to: "",
        date: "",
        departureTime: "",
        arrivalTime: "",
        notes: ""
      };
    },

    // ====== 行程 ======
    async addItinerary() {
      const itineraryData = { ...this.newItinerary };

      if (itineraryData.fromItineraryId !== "" && itineraryData.lat && itineraryData.lng) {
        const fromItinerary = this.itineraries[itineraryData.fromItineraryId];
        if (fromItinerary && fromItinerary.lat && fromItinerary.lng) {
          itineraryData.routeInfo = await this.calculateRouteBetween(
            fromItinerary,
            itineraryData
          );
        }
      }

      if (this.editingItineraryIndex !== null) {
        this.itineraries[this.editingItineraryIndex] = itineraryData;
        this.editingItineraryIndex = null;
      } else {
        this.itineraries.push(itineraryData);
      }
      this.resetItineraryForm();
    },

    async editItinerary(index) {
      this.newItinerary = { ...this.itineraries[index] };
      this.editingItineraryIndex = index;

      if (this.newItinerary.fromItineraryId !== "" && this.newItinerary.lat && this.newItinerary.lng) {
        const fromItinerary = this.itineraries[this.newItinerary.fromItineraryId];
        if (fromItinerary && fromItinerary.lat && fromItinerary.lng) {
          this.newItinerary.routeInfo = await this.calculateRouteBetween(
            fromItinerary,
            this.newItinerary
          );
        }
      }
    },

    deleteItinerary(index) {
      if (confirm("確定要刪除這個行程嗎？")) {
        this.itineraries.splice(index, 1);
      }
    },

    resetItineraryForm() {
      this.newItinerary = {
        date: "",
        time: "",
        location: "",
        description: "",
        address: "",
        lat: "",
        lng: "",
        fromItineraryId: "",
        routeInfo: null
      };
      this.showSuggestions = false;
      this.placeSuggestions = [];
    },

    getItineraryName(id) {
      if (id === null || id === undefined || id === "") return "未知地點";
      const itinerary = this.itineraries[id];
      return itinerary ? `${itinerary.location}` : "未知地點";
    },

    // 計算兩個行程之間的路線（大眾運輸 + 步行）
    calculateRouteBetween(fromItinerary, toItinerary) {
      return new Promise((resolve) => {
        if (!this.directionsService) {
          resolve(null);
          return;
        }

        const origin = {
          lat: parseFloat(fromItinerary.lat),
          lng: parseFloat(fromItinerary.lng)
        };
        const destination = {
          lat: parseFloat(toItinerary.lat),
          lng: parseFloat(toItinerary.lng)
        };

        const routes = [];
        let completed = 0;
        const totalModes = 2;

        // TRANSIT
        this.directionsService.route(
          {
            origin,
            destination,
            travelMode: google.maps.TravelMode.TRANSIT,
            language: "zh-TW",
            transitOptions: {
              modes: [google.maps.TransitMode.SUBWAY, google.maps.TransitMode.BUS],
              routingPreference: google.maps.TransitRoutePreference.LESS_WALKING
            }
          },
          (result, status) => {
            if (status === "OK" && result.routes[0]) {
              const leg = result.routes[0].legs[0];
              const transitDetails = [];

              leg.steps.forEach((step) => {
                if (step.travel_mode === "WALKING") {
                  transitDetails.push({
                    type: "WALKING",
                    instruction: step.instructions.replace(/<[^>]*>/g, ""),
                    duration: step.duration.text
                  });
                } else if (step.travel_mode === "TRANSIT" && step.transit) {
                  const t = step.transit;
                  transitDetails.push({
                    type: "TRANSIT",
                    departureStop: t.departure_stop.name,
                    arrivalStop: t.arrival_stop.name,
                    lineName: t.line.name,
                    headsign: t.headsign || "",
                    numStops: t.num_stops,
                    duration: step.duration.text
                  });
                }
              });

              // 轉乘
              const transitSteps = leg.steps.filter(
                (s) => s.travel_mode === "TRANSIT"
              );
              if (transitSteps.length > 1) {
                for (let i = 0; i < transitSteps.length - 1; i++) {
                  const currentStep = transitSteps[i];
                  const nextStep = transitSteps[i + 1];
                  const transferStation = currentStep.transit.arrival_stop.name;

                  transitDetails.push({
                    type: "TRANSFER",
                    station: transferStation,
                    toLine: nextStep.transit.line.name
                  });
                }
              }

              routes.push({
                mode: "TRANSIT",
                duration: leg.duration.text,
                distance: leg.distance.text,
                transitDetails
              });
            }
            completed++;
            if (completed === totalModes) resolve(routes.length > 0 ? routes : null);
          }
        );

        // WALKING
        this.directionsService.route(
          {
            origin,
            destination,
            travelMode: google.maps.TravelMode.WALKING,
            language: "zh-TW"
          },
          (result, status) => {
            if (status === "OK" && result.routes[0]) {
              const leg = result.routes[0].legs[0];
              routes.push({
                mode: "WALKING",
                duration: leg.duration.text,
                distance: leg.distance.text,
                steps: leg.steps.map((step) => ({
                  instruction: step.instructions.replace(/<[^>]*>/g, ""),
                  duration: step.duration.text
                }))
              });
            }
            completed++;
            if (completed === totalModes) resolve(routes.length > 0 ? routes : null);
          }
        );
      });
    },

    // 快速設定路線（prompt 選出發行程）
    async quickSetRoute(toIndex) {
      if (this.availablePreviousItineraries.length === 0) {
        alert("沒有可用的出發行程，請先新增其他有地點座標的行程");
        return;
      }

      const fromOptions = this.availablePreviousItineraries
        .map(
          (it, idx) => `${idx + 1}. ${it.date} ${it.time} - ${it.location}`
        )
        .join("\n");

      const selected = prompt(
        `請選擇要從哪個行程出發：\n${fromOptions}\n\n請輸入編號（1-${this.availablePreviousItineraries.length}）：`
      );
      const selectedIndex = parseInt(selected) - 1;

      if (
        selectedIndex >= 0 &&
        selectedIndex < this.availablePreviousItineraries.length
      ) {
        const fromItinerary = this.availablePreviousItineraries[selectedIndex];
        this.itineraries[toIndex].fromItineraryId = fromItinerary.originalIndex;

        const routeInfo = await this.calculateRouteBetween(
          fromItinerary,
          this.itineraries[toIndex]
        );
        this.itineraries[toIndex].routeInfo = routeInfo;

        alert("路線已設定完成！");
      }
    },

    // 顯示兩個行程之間的路線（地圖 modal）
    async showRouteBetween(fromId, toIdOrLocation) {
      const fromItinerary =
        typeof fromId === "number" ? this.itineraries[fromId] : null;
      let toItinerary;

      if (typeof toIdOrLocation === "object" && toIdOrLocation.lat) {
        toItinerary = {
          location: toIdOrLocation.location,
          lat: toIdOrLocation.lat,
          lng: toIdOrLocation.lng
        };
      } else {
        toItinerary = this.itineraries[toIdOrLocation];
      }

      if (!fromItinerary || !toItinerary || !fromItinerary.lat || !toItinerary.lat) {
        alert("無法計算路線：請確認兩個行程都有正確的地點座標");
        return;
      }

      this.currentLocationName = `從 ${fromItinerary.location} 到 ${toItinerary.location}`;

      if (!this.map) this.initMap();

      const origin = {
        lat: parseFloat(fromItinerary.lat),
        lng: parseFloat(fromItinerary.lng)
      };
      const destination = {
        lat: parseFloat(toItinerary.lat),
        lng: parseFloat(toItinerary.lng)
      };

      this.showMapModal = true;
      this.routeInfo = await this.calculateRouteBetween(
        fromItinerary,
        toItinerary
      );

      if (this.routeInfo && this.routeInfo.length > 0) {
        const transitRoute = this.routeInfo.find((r) => r.mode === "TRANSIT");
        if (transitRoute) {
          this.directionsService.route(
            {
              origin,
              destination,
              travelMode: google.maps.TravelMode.TRANSIT,
              language: "zh-TW",
              transitOptions: {
                modes: [google.maps.TransitMode.SUBWAY, google.maps.TransitMode.BUS]
              }
            },
            (result, status) => {
              if (status === "OK") {
                this.directionsRenderer.setDirections(result);
              }
            }
          );
        } else {
          const walkingRoute = this.routeInfo.find((r) => r.mode === "WALKING");
          if (walkingRoute) {
            this.directionsService.route(
              {
                origin,
                destination,
                travelMode: google.maps.TravelMode.WALKING,
                language: "zh-TW"
              },
              (result, status) => {
                if (status === "OK") {
                  this.directionsRenderer.setDirections(result);
                }
              }
            );
          }
        }
      }
    },

    // ====== 住宿 ======
    addAccommodation() {
      if (this.editingAccommodationIndex !== null) {
        this.accommodations[this.editingAccommodationIndex] = {
          ...this.newAccommodation
        };
        this.editingAccommodationIndex = null;
      } else {
        this.accommodations.push({ ...this.newAccommodation });
      }
      this.resetAccommodationForm();
    },
    editAccommodation(index) {
      this.newAccommodation = { ...this.accommodations[index] };
      this.editingAccommodationIndex = index;
    },
    deleteAccommodation(index) {
      if (confirm("確定要刪除這筆住宿記錄嗎？")) {
        this.accommodations.splice(index, 1);
      }
    },
    resetAccommodationForm() {
      this.newAccommodation = {
        name: "",
        checkIn: "",
        checkOut: "",
        address: "",
        phone: "",
        roomNumber: "",
        notes: ""
      };
    },

    // ====== 記帳 ======
    addExpense() {
      if (this.editingExpenseIndex !== null) {
        this.expenses[this.editingExpenseIndex] = { ...this.newExpense };
        this.editingExpenseIndex = null;
      } else {
        this.expenses.push({ ...this.newExpense });
      }
      this.resetExpenseForm();
    },
    editExpense(index) {
      this.newExpense = { ...this.expenses[index] };
      this.editingExpenseIndex = index;
    },
    deleteExpense(index) {
      if (confirm("確定要刪除這筆記錄嗎？")) {
        this.expenses.splice(index, 1);
      }
    },
    resetExpenseForm() {
      this.newExpense = {
        type: "",
        amount: 0,
        category: "",
        date: "",
        time: "",
        notes: ""
      };
    },

    convertToTWD(krwAmount) {
      return Math.round(krwAmount * this.exchangeRate);
    },

    // ====== 日期格式 ======
    formatDate(dateString) {
      if (!dateString) return "";
      const date = new Date(dateString);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
      const weekday = weekdays[date.getDay()];
      return `${year}年${month}月${day}日（星期${weekday}）`;
    },
    formatDateRange(startDate, endDate) {
      if (!startDate || !endDate) return "";
      const start = new Date(startDate);
      const end = new Date(endDate);
      const startStr = `${start.getMonth() + 1}/${start.getDate()}`;
      const endStr = `${end.getMonth() + 1}/${end.getDate()}`;
      return `${startStr} - ${endStr}`;
    },

    // ====== Google Maps ======
    initMap() {
      try {
        if (typeof google === "undefined" || !google.maps) {
          console.warn("Google Maps API 未載入");
          return;
        }

        const mapElement = document.getElementById("map");
        if (!mapElement) return;

        const seoul = { lat: 37.5665, lng: 126.978 };
        this.map = new google.maps.Map(mapElement, {
          zoom: 13,
          center: seoul,
          mapTypeControl: true,
          streetViewControl: true
        });

        this.placesService = new google.maps.places.PlacesService(this.map);
        this.autocompleteService = new google.maps.places.AutocompleteService();
        this.directionsService = new google.maps.DirectionsService();
        this.directionsRenderer = new google.maps.DirectionsRenderer();
        this.directionsRenderer.setMap(this.map);

        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (position) => {
              this.currentPosition = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
              };
            },
            () => {
              this.currentPosition = seoul;
            }
          );
        } else {
          this.currentPosition = seoul;
        }
      } catch (e) {
        console.error("初始化地圖錯誤:", e);
      }
    },

    searchPlaces() {
      if (!this.autocompleteService || !this.newItinerary.location) {
        this.placeSuggestions = [];
        return;
      }

      this.autocompleteService.getPlacePredictions(
        {
          input: this.newItinerary.location,
          componentRestrictions: { country: "kr" },
          language: "zh-TW"
        },
        (predictions, status) => {
          if (
            status === google.maps.places.PlacesServiceStatus.OK &&
            predictions
          ) {
            this.placeSuggestions = predictions.map((pred) => ({
              name: pred.description,
              placeId: pred.place_id,
              address: pred.description
            }));
          } else {
            this.placeSuggestions = [];
          }
        }
      );
    },

    selectPlace(suggestion) {
      this.newItinerary.location = suggestion.name;
      this.showSuggestions = false;

      if (this.placesService) {
        const request = {
          placeId: suggestion.placeId,
          fields: ["name", "formatted_address", "geometry"]
        };

        this.placesService.getDetails(request, (place, status) => {
          if (status === google.maps.places.PlacesServiceStatus.OK) {
            this.newItinerary.address = place.formatted_address;
            this.newItinerary.lat = place.geometry.location.lat();
            this.newItinerary.lng = place.geometry.location.lng();
          }
        });
      }
    },

    showMap(location) {
      if (!this.map) this.initMap();

      this.currentLocationName = location.location || location.name || "地點";
      this.currentLocation = {
        lat: parseFloat(location.lat),
        lng: parseFloat(location.lng)
      };
      this.routeInfo = null;

      this.map.setCenter(this.currentLocation);
      this.map.setZoom(15);

      if (this.currentMarker) this.currentMarker.setMap(null);

      this.currentMarker = new google.maps.Marker({
        position: this.currentLocation,
        map: this.map,
        title: this.currentLocationName
      });

      this.showMapModal = true;
    },

    showRoute(destination) {
      if (!this.map) this.initMap();

      this.currentLocationName = destination.location || destination.name || "目的地";
      const dest = {
        lat: parseFloat(destination.lat),
        lng: parseFloat(destination.lng)
      };

      const origin = this.currentPosition || { lat: 37.5665, lng: 126.978 };

      this.showMapModal = true;
      this.routeInfo = [];

      this.directionsRenderer.setDirections({ routes: [] });

      const modes = [
        { mode: "TRANSIT", name: "大眾運輸" },
        { mode: "DRIVING", name: "開車" },
        { mode: "WALKING", name: "步行" }
      ];

      modes.forEach(({ mode, name }) => {
        this.directionsService.route(
          {
            origin,
            destination: dest,
            travelMode: google.maps.TravelMode[mode],
            language: "zh-TW"
          },
          (result, status) => {
            if (status === "OK" && result.routes[0]) {
              const leg = result.routes[0].legs[0];
              const routeData = {
                mode,
                name,
                duration: leg.duration.text,
                distance: leg.distance.text,
                steps: leg.steps.map((step) => ({
                  instruction: step.instructions.replace(/<[^>]*>/g, ""),
                  duration: step.duration.text
                }))
              };
              this.routeInfo.push(routeData);

              if (mode === "TRANSIT") {
                this.directionsRenderer.setDirections(result);
              }
            }
          }
        );
      });
    },

    closeMapModal() {
      this.showMapModal = false;
      this.routeInfo = null;
      if (this.currentMarker) this.currentMarker.setMap(null);
    },

    // ====== 必備物品清單 ======
    addChecklistItem() {
      this.checklistItems.push({
        name: this.newChecklistItem.name,
        person1Checked: false,
        person2Checked: false
      });
      this.newChecklistItem.name = "";
    },
    toggleChecklistItem(index, person) {
      if (person === "person1") {
        this.checklistItems[index].person1Checked =
          !this.checklistItems[index].person1Checked;
      } else if (person === "person2") {
        this.checklistItems[index].person2Checked =
          !this.checklistItems[index].person2Checked;
      }
    },
    deleteChecklistItem(index) {
      if (confirm("確定要刪除這個物品嗎？")) {
        this.checklistItems.splice(index, 1);
      }
    },
    isItemCompleted(item) {
      return item.person1Checked && item.person2Checked;
    },
    getPersonCheckedCount(person) {
      return this.checklistItems.filter((item) =>
        person === "person1" ? item.person1Checked : item.person2Checked
      ).length;
    },
    getPersonCompletion(person) {
      if (this.checklistItems.length === 0) return 0;
      return Math.round(
        (this.getPersonCheckedCount(person) / this.checklistItems.length) * 100
      );
    },

    // ====== PWA 安裝 ======
    showInstallPrompt() {
      this.showInstallButton = true;
    },
    async installApp() {
      if (this.deferredPrompt) {
        this.deferredPrompt.prompt();
        const { outcome } = await this.deferredPrompt.userChoice;
        console.log("用戶選擇:", outcome);
        this.deferredPrompt = null;
        this.showInstallButton = false;
      }
    }
  },

  mounted() {
    // 讓 Google Maps callback 找得到 Vue 物件
    window.vueApp = this;

    // Firestore 載入 & 即時監聽
    this.loadFromFirestoreAndListen();

    // PWA Service Worker（如果有放 service-worker.js）
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker
          .register("./service-worker.js")
          .then((reg) => console.log("ServiceWorker 註冊成功:", reg.scope))
          .catch((err) => console.log("ServiceWorker 註冊失敗:", err));
      });
    }

    // 安裝提示事件
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      this.deferredPrompt = e;
      this.showInstallPrompt();
    });

    // 若 Google Maps 已經載入就初始化
    if (window.googleMapsLoaded) {
      setTimeout(() => {
        if (typeof google !== "undefined" && google.maps) {
          this.initMap();
        }
      }, 500);
    }
  },

  watch: {
    transports: {
      deep: true,
      handler() {
        this.saveToFirestore();
      }
    },
    itineraries: {
      deep: true,
      handler() {
        this.saveToFirestore();
      }
    },
    accommodations: {
      deep: true,
      handler() {
        this.saveToFirestore();
      }
    },
    expenses: {
      deep: true,
      handler() {
        this.saveToFirestore();
      }
    },
    checklistItems: {
      deep: true,
      handler() {
        this.saveToFirestore();
      }
    },
    exchangeRate() {
      this.saveToFirestore();
    },
    person1Name() {
      this.saveToFirestore();
    },
    person2Name() {
      this.saveToFirestore();
    },
    tripDays(newVal) {
      if (
        newVal.length > 0 &&
        !newVal.find((d) => d.dayNumber === this.selectedDayNumber)
      ) {
        this.selectedDayNumber = 1;
      }
    }
  }
});

// 掛載 Vue
app.mount("#app");
