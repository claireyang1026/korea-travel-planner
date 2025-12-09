// 全域錯誤處理
window.addEventListener('error', function (e) {
    console.error('發生錯誤:', e.error || e.message || e);
});

// 給 Google Maps callback 用的旗標
window.googleMapsLoaded = false;

// Google Maps 載入完成時會呼叫這個
window.initGoogleMaps = function () {
    window.googleMapsLoaded = true;
    if (window.vueApp && window.vueApp.initMap) {
        setTimeout(() => {
            if (typeof google !== 'undefined' && google.maps) {
                window.vueApp.initMap();
            }
        }, 100);
    }
};

// 如果 Vue 沒載入，顯示錯誤畫面
if (typeof Vue === 'undefined') {
    const appEl = document.getElementById('app');
    if (appEl) {
        appEl.innerHTML = `
            <div style="padding: 20px; text-align: center;">
                <h2>錯誤：Vue.js 未載入</h2>
                <p>請檢查網路連線或重新整理頁面</p>
            </div>
        `;
    }
} else {
    const { createApp } = Vue;

    const app = createApp({
        data() {
            return {
                activeTab: 'transport',
                tabs: [
                    { id: 'daily', name: '每日行程總覽' },
                    { id: 'transport', name: '機票/車票' },
                    { id: 'itinerary', name: '行程規劃' },
                    { id: 'accommodation', name: '入住資料' },
                    { id: 'expense', name: '記帳功能' },
                    { id: 'checklist', name: '必備物品清單' }
                ],
                // 每日行程總覽
                selectedDate: new Date().toISOString().split('T')[0],
                selectedDayNumber: 1,
                // 匯率設定（1韓元 = ? 台幣，預設約0.025，即1台幣=40韓元）
                exchangeRate: 0.025,
                // Google Maps 相關
                map: null,
                mapModal: null,
                showMapModal: false,
                currentLocationName: '',
                currentLocation: null,
                currentMarker: null,
                placeSuggestions: [],
                showSuggestions: false,
                placesService: null,
                autocompleteService: null,
                directionsService: null,
                directionsRenderer: null,
                routeInfo: null,
                // 當前位置（用於路線規劃）
                currentPosition: null,
                // 交通資料
                transports: [],
                newTransport: {
                    type: '',
                    from: '',
                    to: '',
                    date: '',
                    departureTime: '',
                    arrivalTime: '',
                    notes: ''
                },
                editingTransportIndex: null,
                // 行程資料
                itineraries: [],
                newItinerary: {
                    date: '',
                    time: '',
                    location: '',
                    description: '',
                    address: '',
                    lat: '',
                    lng: '',
                    fromItineraryId: '',
                    routeInfo: null
                },
                editingItineraryIndex: null,
                // 住宿資料
                accommodations: [],
                newAccommodation: {
                    name: '',
                    checkIn: '',
                    checkOut: '',
                    address: '',
                    phone: '',
                    roomNumber: '',
                    notes: ''
                },
                editingAccommodationIndex: null,
                // 記帳資料
                expenses: [],
                newExpense: {
                    type: '',
                    amount: 0,
                    category: '',
                    date: '',
                    time: '',
                    notes: ''
                },
                editingExpenseIndex: null,
                // 必備物品清單
                checklistItems: [],
                newChecklistItem: {
                    name: ''
                },
                person1Name: '人員 1',
                person2Name: '人員 2',
                // PWA 安裝提示
                showInstallButton: false,
                deferredPrompt: null
            };
        },
        computed: {
            sortedItineraries() {
                return [...this.itineraries].sort((a, b) => {
                    const dateCompare = a.date.localeCompare(b.date);
                    if (dateCompare !== 0) return dateCompare;
                    return a.time.localeCompare(b.time);
                });
            },
            availablePreviousItineraries() {
                // 返回有座標的行程，作為可選的出發點
                return this.itineraries
                    .map((it, idx) => ({ ...it, originalIndex: idx }))
                    .filter((it, idx) => {
                        // 只顯示有座標的行程
                        if (!it.lat || !it.lng) return false;
                        // 如果是編輯模式，排除自己
                        if (this.editingItineraryIndex !== null) {
                            return idx !== this.editingItineraryIndex;
                        }
                        return true;
                    });
            },
            sortedExpenses() {
                return [...this.expenses].sort((a, b) => {
                    const dateCompare = b.date.localeCompare(a.date);
                    if (dateCompare !== 0) return dateCompare;
                    return b.time.localeCompare(a.time);
                });
            },
            totalIncome() {
                return this.expenses
                    .filter(e => e.type === 'income')
                    .reduce((sum, e) => sum + e.amount, 0);
            },
            totalExpense() {
                return this.expenses
                    .filter(e => e.type === 'expense')
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
            // 計算行程天數（根據所有行程資料）
            tripStartDate() {
                const allDates = [];
                
                // 收集所有機票日期
                this.transports.filter(t => t.type === '機票').forEach(f => {
                    allDates.push(f.date);
                });
                
                // 收集所有行程日期
                this.itineraries.forEach(i => {
                    if (i.date) allDates.push(i.date);
                });
                
                // 收集所有住宿日期（入住和退房）
                this.accommodations.forEach(a => {
                    if (a.checkIn) allDates.push(a.checkIn);
                    if (a.checkOut) allDates.push(a.checkOut);
                });
                
                if (allDates.length === 0) return null;
                
                // 找出最早的日期
                return allDates.sort()[0];
            },
            tripEndDate() {
                const allDates = [];
                
                // 收集所有機票日期
                this.transports.filter(t => t.type === '機票').forEach(f => {
                    allDates.push(f.date);
                });
                
                // 收集所有行程日期
                this.itineraries.forEach(i => {
                    if (i.date) allDates.push(i.date);
                });
                
                // 收集所有住宿日期（入住和退房）
                this.accommodations.forEach(a => {
                    if (a.checkIn) allDates.push(a.checkIn);
                    if (a.checkOut) allDates.push(a.checkOut);
                });
                
                if (allDates.length === 0) return null;
                
                // 找出最晚的日期
                const sortedDates = allDates.sort();
                return sortedDates[sortedDates.length - 1];
            },
            tripDays() {
                if (!this.tripStartDate || !this.tripEndDate) return [];
                
                const days = [];
                // 使用本地時間解析日期，避免時區問題
                const startParts = this.tripStartDate.split('-');
                const endParts = this.tripEndDate.split('-');
                const start = new Date(parseInt(startParts[0]), parseInt(startParts[1]) - 1, parseInt(startParts[2]));
                const end = new Date(parseInt(endParts[0]), parseInt(endParts[1]) - 1, parseInt(endParts[2]));
                
                // 計算天數差
                let currentDate = new Date(start);
                let dayNumber = 1;
                
                // 確保 end 日期包含在內（比較日期部分，忽略時間）
                const endDateOnly = new Date(end.getFullYear(), end.getMonth(), end.getDate());
                
                while (currentDate <= endDateOnly) {
                    const year = currentDate.getFullYear();
                    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
                    const day = String(currentDate.getDate()).padStart(2, '0');
                    const dateStr = `${year}-${month}-${day}`;
                    
                    days.push({
                        dayNumber: dayNumber,
                        date: dateStr,
                        label: `Day ${dayNumber}`
                    });
                    dayNumber++;
                    // 創建新的日期物件，避免修改原物件
                    currentDate = new Date(currentDate);
                    currentDate.setDate(currentDate.getDate() + 1);
                }
                
                return days;
            },
            currentDayInfo() {
                return this.tripDays.find(d => d.dayNumber === this.selectedDayNumber) || null;
            },
            dailySchedule() {
                // 如果選定了天數，使用對應的日期
                let targetDate = this.selectedDate;
                if (this.currentDayInfo) {
                    targetDate = this.currentDayInfo.date;
                }
                
                const schedule = [];
                
                // 加入交通資訊
                this.transports.forEach(transport => {
                    if (transport.date === targetDate) {
                        schedule.push({
                            time: transport.departureTime,
                            title: `${transport.type}：${transport.from} → ${transport.to}`,
                            type: '交通',
                            details: `抵達時間：${transport.arrivalTime}`,
                            extraInfo: transport.notes ? `備註：${transport.notes}` : null,
                            color: '#3498db'
                        });
                    }
                });

                // 加入行程規劃
                this.itineraries.forEach((itinerary) => {
                    if (itinerary.date === targetDate) {
                        const routeInfoText = itinerary.routeInfo && itinerary.routeInfo.length > 0 
                            ? `從 ${this.getItineraryName(itinerary.fromItineraryId)} 出發：${itinerary.routeInfo[0].duration}（${itinerary.routeInfo[0].distance}）`
                            : null;
                        
                        schedule.push({
                            time: itinerary.time,
                            title: itinerary.location,
                            type: '行程',
                            details: itinerary.description || null,
                            extraInfo: routeInfoText,
                            color: '#27ae60',
                            locationData: (itinerary.lat && itinerary.lng) ? {
                                location: itinerary.location,
                                lat: itinerary.lat,
                                lng: itinerary.lng,
                                address: itinerary.address,
                                routeInfo: itinerary.routeInfo,
                                fromItineraryId: itinerary.fromItineraryId
                            } : null
                        });
                    }
                });

                // 加入住宿資訊（入住/退房）
                this.accommodations.forEach(accommodation => {
                    if (accommodation.checkIn === targetDate) {
                        schedule.push({
                            time: '14:00',
                            title: `入住：${accommodation.name}`,
                            type: '住宿',
                            details: accommodation.address ? `地址：${accommodation.address}` : null,
                            extraInfo: accommodation.roomNumber ? `房間：${accommodation.roomNumber}` : null,
                            color: '#e67e22'
                        });
                    }
                    if (accommodation.checkOut === targetDate) {
                        schedule.push({
                            time: '11:00',
                            title: `退房：${accommodation.name}`,
                            type: '住宿',
                            details: null,
                            extraInfo: null,
                            color: '#e67e22'
                        });
                    }
                });

                // 按時間排序
                return schedule.sort((a, b) => a.time.localeCompare(b.time));
            }
        },
        methods: {
            // 交通相關方法
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
                if (confirm('確定要刪除這筆記錄嗎？')) {
                    this.transports.splice(index, 1);
                }
            },
            resetTransportForm() {
                this.newTransport = {
                    type: '',
                    from: '',
                    to: '',
                    date: '',
                    departureTime: '',
                    arrivalTime: '',
                    notes: ''
                };
            },
            // 行程相關方法
            async addItinerary() {
                const itineraryData = { ...this.newItinerary };
                
                // 如果有選擇從哪個行程出發，計算路線
                if (itineraryData.fromItineraryId && itineraryData.lat && itineraryData.lng) {
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
                
                // 如果編輯時有選擇從哪個行程出發，重新計算路線
                if (this.newItinerary.fromItineraryId && this.newItinerary.lat && this.newItinerary.lng) {
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
                if (confirm('確定要刪除這個行程嗎？')) {
                    this.itineraries.splice(index, 1);
                }
            },
            resetItineraryForm() {
                this.newItinerary = {
                    date: '',
                    time: '',
                    location: '',
                    description: '',
                    address: '',
                    lat: '',
                    lng: '',
                    fromItineraryId: '',
                    routeInfo: null
                };
                this.showSuggestions = false;
                this.placeSuggestions = [];
            },
            getItineraryName(id) {
                if (id === null || id === undefined || id === '') return '未知地點';
                const itinerary = this.itineraries[id];
                return itinerary ? `${itinerary.location}` : '未知地點';
            },
            // 計算兩個行程之間的路線
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
                    const totalModes = 2; // TRANSIT 和 WALKING

                    // 計算大眾運輸路線（優先）
                    this.directionsService.route({
                        origin: origin,
                        destination: destination,
                        travelMode: google.maps.TravelMode.TRANSIT,
                        language: 'zh-TW',
                        transitOptions: {
                            modes: [google.maps.TransitMode.SUBWAY, google.maps.TransitMode.BUS],
                            routingPreference: google.maps.TransitRoutePreference.LESS_WALKING
                        }
                    }, (result, status) => {
                        if (status === 'OK' && result.routes[0]) {
                            const route = result.routes[0];
                            const leg = route.legs[0];
                            
                            const transitDetails = [];
                            
                            leg.steps.forEach(step => {
                                if (step.travel_mode === 'WALKING') {
                                    transitDetails.push({
                                        type: 'WALKING',
                                        instruction: step.instructions.replace(/<[^>]*>/g, ''),
                                        duration: step.duration.text
                                    });
                                } else if (step.travel_mode === 'TRANSIT' && step.transit) {
                                    const transit = step.transit;
                                    transitDetails.push({
                                        type: 'TRANSIT',
                                        departureStop: transit.departure_stop.name,
                                        arrivalStop: transit.arrival_stop.name,
                                        lineName: transit.line.name,
                                        headsign: transit.headsign || '',
                                        numStops: transit.num_stops,
                                        duration: step.duration.text
                                    });
                                }
                            });

                            // 檢查是否有轉乘
                            const transitSteps = leg.steps.filter(s => s.travel_mode === 'TRANSIT');
                            if (transitSteps.length > 1) {
                                // 找出轉乘點
                                for (let i = 0; i < transitSteps.length - 1; i++) {
                                    const currentStep = transitSteps[i];
                                    const nextStep = transitSteps[i + 1];
                                    const transferStation = currentStep.transit.arrival_stop.name;
                                    
                                    transitDetails.push({
                                        type: 'TRANSFER',
                                        station: transferStation,
                                        toLine: nextStep.transit.line.name
                                    });
                                }
                            }

                            routes.push({
                                mode: 'TRANSIT',
                                duration: leg.duration.text,
                                distance: leg.distance.text,
                                transitDetails: transitDetails
                            });
                        }
                        
                        completed++;
                        if (completed === totalModes) {
                            resolve(routes.length > 0 ? routes : null);
                        }
                    });

                    // 計算步行路線（備選）
                    this.directionsService.route({
                        origin: origin,
                        destination: destination,
                        travelMode: google.maps.TravelMode.WALKING,
                        language: 'zh-TW'
                    }, (result, status) => {
                        if (status === 'OK' && result.routes[0]) {
                            const route = result.routes[0];
                            const leg = route.legs[0];
                            
                            routes.push({
                                mode: 'WALKING',
                                duration: leg.duration.text,
                                distance: leg.distance.text,
                                steps: leg.steps.map(step => ({
                                    instruction: step.instructions.replace(/<[^>]*>/g, ''),
                                    duration: step.duration.text
                                }))
                            });
                        }
                        
                        completed++;
                        if (completed === totalModes) {
                            resolve(routes.length > 0 ? routes : null);
                        }
                    });
                });
            },
            // 快速設定路線（從現有行程選擇）
            async quickSetRoute(toIndex) {
                if (this.availablePreviousItineraries.length === 0) {
                    alert('沒有可用的出發行程，請先新增其他有地點座標的行程');
                    return;
                }
                
                const fromOptions = this.availablePreviousItineraries.map((it, idx) => 
                    `${idx + 1}. ${it.date} ${it.time} - ${it.location}`
                ).join('\n');
                
                const selected = prompt(`請選擇要從哪個行程出發：\n${fromOptions}\n\n請輸入編號（1-${this.availablePreviousItineraries.length}）：`);
                const selectedIndex = parseInt(selected) - 1;
                
                if (selectedIndex >= 0 && selectedIndex < this.availablePreviousItineraries.length) {
                    const fromItinerary = this.availablePreviousItineraries[selectedIndex];
                    this.itineraries[toIndex].fromItineraryId = fromItinerary.originalIndex;
                    
                    // 計算路線
                    const routeInfo = await this.calculateRouteBetween(
                        fromItinerary,
                        this.itineraries[toIndex]
                    );
                    this.itineraries[toIndex].routeInfo = routeInfo;
                    
                    alert('路線已設定完成！');
                }
            },
            // 顯示兩個行程之間的路線
            async showRouteBetween(fromId, toIdOrLocation) {
                const fromItinerary = typeof fromId === 'number' ? this.itineraries[fromId] : null;
                let toItinerary;
                
                if (typeof toIdOrLocation === 'object' && toIdOrLocation.lat) {
                    // 如果是從每日行程總覽點擊，toIdOrLocation 是 locationData 物件
                    toItinerary = {
                        location: toIdOrLocation.location,
                        lat: toIdOrLocation.lat,
                        lng: toIdOrLocation.lng
                    };
                } else {
                    // 否則是行程索引
                    toItinerary = this.itineraries[toIdOrLocation];
                }
                
                if (!fromItinerary || !toItinerary || !fromItinerary.lat || !toItinerary.lat) {
                    alert('無法計算路線：請確認兩個行程都有正確的地點座標');
                    return;
                }

                this.currentLocationName = `從 ${fromItinerary.location} 到 ${toItinerary.location}`;
                
                if (!this.map) {
                    this.initMap();
                }

                const origin = {
                    lat: parseFloat(fromItinerary.lat),
                    lng: parseFloat(fromItinerary.lng)
                };
                const destination = {
                    lat: parseFloat(toItinerary.lat),
                    lng: parseFloat(toItinerary.lng)
                };

                this.showMapModal = true;
                this.routeInfo = await this.calculateRouteBetween(fromItinerary, toItinerary);

                // 顯示地圖路線
                if (this.routeInfo && this.routeInfo.length > 0) {
                    const transitRoute = this.routeInfo.find(r => r.mode === 'TRANSIT');
                    if (transitRoute) {
                        this.directionsService.route({
                            origin: origin,
                            destination: destination,
                            travelMode: google.maps.TravelMode.TRANSIT,
                            language: 'zh-TW',
                            transitOptions: {
                                modes: [google.maps.TransitMode.SUBWAY, google.maps.TransitMode.BUS]
                            }
                        }, (result, status) => {
                            if (status === 'OK') {
                                this.directionsRenderer.setDirections(result);
                            }
                        });
                    } else {
                        // 如果沒有大眾運輸路線，顯示步行路線
                        const walkingRoute = this.routeInfo.find(r => r.mode === 'WALKING');
                        if (walkingRoute) {
                            this.directionsService.route({
                                origin: origin,
                                destination: destination,
                                travelMode: google.maps.TravelMode.WALKING,
                                language: 'zh-TW'
                            }, (result, status) => {
                                if (status === 'OK') {
                                    this.directionsRenderer.setDirections(result);
                                }
                            });
                        }
                    }
                }
            },
            // 住宿相關方法
            addAccommodation() {
                if (this.editingAccommodationIndex !== null) {
                    this.accommodations[this.editingAccommodationIndex] = { ...this.newAccommodation };
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
                if (confirm('確定要刪除這筆住宿記錄嗎？')) {
                    this.accommodations.splice(index, 1);
                }
            },
            resetAccommodationForm() {
                this.newAccommodation = {
                    name: '',
                    checkIn: '',
                    checkOut: '',
                    address: '',
                    phone: '',
                    roomNumber: '',
                    notes: ''
                };
            },
            // 記帳相關方法
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
                if (confirm('確定要刪除這筆記錄嗎？')) {
                    this.expenses.splice(index, 1);
                }
            },
            resetExpenseForm() {
                this.newExpense = {
                    type: '',
                    amount: 0,
                    category: '',
                    date: '',
                    time: '',
                    notes: ''
                };
            },
            // 匯率換算
            convertToTWD(krwAmount) {
                return Math.round(krwAmount * this.exchangeRate);
            },
            // 日期格式化
            formatDate(dateString) {
                if (!dateString) return '';
                const date = new Date(dateString);
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
                const weekday = weekdays[date.getDay()];
                return `${year}年${month}月${day}日（星期${weekday}）`;
            },
            // 日期範圍格式化
            formatDateRange(startDate, endDate) {
                if (!startDate || !endDate) return '';
                const start = new Date(startDate);
                const end = new Date(endDate);
                const startStr = `${start.getMonth() + 1}/${start.getDate()}`;
                const endStr = `${end.getMonth() + 1}/${end.getDate()}`;
                return `${startStr} - ${endStr}`;
            },
            // Google Maps 相關方法
            initMap() {
                try {
                    if (typeof google === 'undefined' || !google.maps) {
                        console.warn('Google Maps API 未載入，請確認 API Key 是否正確設定');
                        return;
                    }

                    // 檢查地圖容器是否存在
                    const mapElement = document.getElementById('map');
                    if (!mapElement) {
                        return;
                    }

                    // 初始化地圖（首爾市中心）
                    const seoul = { lat: 37.5665, lng: 126.9780 };
                    this.map = new google.maps.Map(mapElement, {
                        zoom: 13,
                        center: seoul,
                        mapTypeControl: true,
                        streetViewControl: true
                    });

                    // 初始化服務
                    this.placesService = new google.maps.places.PlacesService(this.map);
                    this.autocompleteService = new google.maps.places.AutocompleteService();
                    this.directionsService = new google.maps.DirectionsService();
                    this.directionsRenderer = new google.maps.DirectionsRenderer();
                    this.directionsRenderer.setMap(this.map);

                    // 獲取當前位置
                    if (navigator.geolocation) {
                        navigator.geolocation.getCurrentPosition(
                            (position) => {
                                this.currentPosition = {
                                    lat: position.coords.latitude,
                                    lng: position.coords.longitude
                                };
                            },
                            () => {
                                // 如果無法獲取位置，使用首爾作為預設
                                this.currentPosition = seoul;
                            }
                        );
                    } else {
                        this.currentPosition = seoul;
                    }
                } catch (error) {
                    console.error('初始化 Google Maps 時發生錯誤:', error);
                }
            },
            searchPlaces() {
                if (!this.autocompleteService || !this.newItinerary.location) {
                    this.placeSuggestions = [];
                    return;
                }

                this.autocompleteService.getPlacePredictions({
                    input: this.newItinerary.location,
                    componentRestrictions: { country: 'kr' }, // 限制在韓國
                    language: 'zh-TW'
                }, (predictions, status) => {
                    if (status === google.maps.places.PlacesServiceStatus.OK && predictions) {
                        this.placeSuggestions = predictions.map(pred => ({
                            name: pred.description,
                            placeId: pred.place_id,
                            address: pred.description
                        }));
                    } else {
                        this.placeSuggestions = [];
                    }
                });
            },
            selectPlace(suggestion) {
                this.newItinerary.location = suggestion.name;
                this.showSuggestions = false;
                
                // 獲取地點詳細資訊
                if (this.placesService) {
                    const request = {
                        placeId: suggestion.placeId,
                        fields: ['name', 'formatted_address', 'geometry']
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
                if (!this.map) {
                    this.initMap();
                }

                this.currentLocationName = location.location || location.name || '地點';
                this.currentLocation = {
                    lat: parseFloat(location.lat),
                    lng: parseFloat(location.lng)
                };
                this.routeInfo = null;

                // 設定地圖中心並標記
                this.map.setCenter(this.currentLocation);
                this.map.setZoom(15);

                // 清除之前的標記
                if (this.currentMarker) {
                    this.currentMarker.setMap(null);
                }

                // 新增標記
                this.currentMarker = new google.maps.Marker({
                    position: this.currentLocation,
                    map: this.map,
                    title: this.currentLocationName
                });

                this.showMapModal = true;
            },
            showRoute(destination) {
                if (!this.map) {
                    this.initMap();
                }

                this.currentLocationName = destination.location || destination.name || '目的地';
                const dest = {
                    lat: parseFloat(destination.lat),
                    lng: parseFloat(destination.lng)
                };

                // 如果沒有當前位置，使用首爾市中心
                const origin = this.currentPosition || { lat: 37.5665, lng: 126.9780 };

                this.showMapModal = true;
                this.routeInfo = [];

                // 清除之前的路線
                if (this.directionsRenderer) {
                    this.directionsRenderer.setDirections({ routes: [] });
                }

                // 嘗試多種交通方式
                const modes = [
                    { mode: 'TRANSIT', name: '大眾運輸' },
                    { mode: 'DRIVING', name: '開車' },
                    { mode: 'WALKING', name: '步行' }
                ];

                modes.forEach(({ mode, name }) => {
                    this.directionsService.route({
                        origin: origin,
                        destination: dest,
                        travelMode: google.maps.TravelMode[mode],
                        language: 'zh-TW'
                    }, (result, status) => {
                        if (status === 'OK' && result.routes[0]) {
                            const route = result.routes[0];
                            const leg = route.legs[0];
                            
                            const routeData = {
                                mode: mode,
                                name: name,
                                duration: leg.duration.text,
                                distance: leg.distance.text,
                                steps: leg.steps.map(step => ({
                                    instruction: step.instructions.replace(/<[^>]*>/g, ''),
                                    duration: step.duration.text
                                }))
                            };

                            this.routeInfo.push(routeData);

                            // 顯示第一個成功的大眾運輸路線
                            if (mode === 'TRANSIT' && status === 'OK') {
                                this.directionsRenderer.setDirections(result);
                            }
                        }
                    });
                });
            },
            closeMapModal() {
                this.showMapModal = false;
                this.routeInfo = null;
                if (this.currentMarker) {
                    this.currentMarker.setMap(null);
                }
            },
            // 必備物品清單相關方法
            addChecklistItem() {
                this.checklistItems.push({
                    name: this.newChecklistItem.name,
                    person1Checked: false,
                    person2Checked: false
                });
                this.newChecklistItem.name = '';
            },
            toggleChecklistItem(index, person) {
                if (person === 'person1') {
                    this.checklistItems[index].person1Checked = !this.checklistItems[index].person1Checked;
                } else if (person === 'person2') {
                    this.checklistItems[index].person2Checked = !this.checklistItems[index].person2Checked;
                }
            },
            deleteChecklistItem(index) {
                if (confirm('確定要刪除這個物品嗎？')) {
                    this.checklistItems.splice(index, 1);
                }
            },
            isItemCompleted(item) {
                return item.person1Checked && item.person2Checked;
            },
            getPersonCheckedCount(person) {
                return this.checklistItems.filter(item => 
                    person === 'person1' ? item.person1Checked : item.person2Checked
                ).length;
            },
            getPersonCompletion(person) {
                if (this.checklistItems.length === 0) return 0;
                return Math.round((this.getPersonCheckedCount(person) / this.checklistItems.length) * 100);
            },
            // PWA 安裝相關方法
            showInstallPrompt() {
                this.showInstallButton = true;
            },
            async installApp() {
                if (this.deferredPrompt) {
                    this.deferredPrompt.prompt();
                    const { outcome } = await this.deferredPrompt.userChoice;
                    console.log(`用戶選擇: ${outcome}`);
                    this.deferredPrompt = null;
                    this.showInstallButton = false;
                }
            }
        },
        mounted() {
            // 讓外部（Google Maps callback）可以拿到 Vue instance
            window.vueApp = this;

            // 註冊 Service Worker (PWA)
            if ('serviceWorker' in navigator) {
                window.addEventListener('load', () => {
                    navigator.serviceWorker.register('./service-worker.js')
                        .then((registration) => {
                            console.log('ServiceWorker 註冊成功:', registration.scope);
                        })
                        .catch((error) => {
                            console.log('ServiceWorker 註冊失敗:', error);
                        });
                });
            }

            // 顯示安裝提示
            window.addEventListener('beforeinstallprompt', (e) => {
                e.preventDefault();
                this.deferredPrompt = e;
                this.showInstallPrompt();
            });

            // 載入本地儲存的資料
            const savedTransports = localStorage.getItem('koreaTravel_transports');
            const savedItineraries = localStorage.getItem('koreaTravel_itineraries');
            const savedAccommodations = localStorage.getItem('koreaTravel_accommodations');
            const savedExpenses = localStorage.getItem('koreaTravel_expenses');
            const savedExchangeRate = localStorage.getItem('koreaTravel_exchangeRate');
            const savedChecklist = localStorage.getItem('koreaTravel_checklist');
            const savedPerson1Name = localStorage.getItem('koreaTravel_person1Name');
            const savedPerson2Name = localStorage.getItem('koreaTravel_person2Name');

            if (savedTransports) this.transports = JSON.parse(savedTransports);
            if (savedItineraries) this.itineraries = JSON.parse(savedItineraries);
            if (savedAccommodations) this.accommodations = JSON.parse(savedAccommodations);
            if (savedExpenses) this.expenses = JSON.parse(savedExpenses);
            if (savedExchangeRate) this.exchangeRate = JSON.parse(savedExchangeRate);
            if (savedChecklist) this.checklistItems = JSON.parse(savedChecklist);
            if (savedPerson1Name) this.person1Name = savedPerson1Name;
            if (savedPerson2Name) this.person2Name = savedPerson2Name;

            // 如果 Google Maps 已經載入，初始化地圖
            if (window.googleMapsLoaded || (typeof google !== 'undefined' && google.maps)) {
                setTimeout(() => {
                    if (typeof google !== 'undefined' && google.maps) {
                        this.initMap();
                    }
                }, 500);
            }
        },
        watch: {
            transports: {
                handler(newVal) {
                    localStorage.setItem('koreaTravel_transports', JSON.stringify(newVal));
                },
                deep: true
            },
            itineraries: {
                handler(newVal) {
                    localStorage.setItem('koreaTravel_itineraries', JSON.stringify(newVal));
                },
                deep: true
            },
            accommodations: {
                handler(newVal) {
                    localStorage.setItem('koreaTravel_accommodations', JSON.stringify(newVal));
                },
                deep: true
            },
            expenses: {
                handler(newVal) {
                    localStorage.setItem('koreaTravel_expenses', JSON.stringify(newVal));
                },
                deep: true
            },
            exchangeRate(newVal) {
                localStorage.setItem('koreaTravel_exchangeRate', JSON.stringify(newVal));
            },
            checklistItems: {
                handler(newVal) {
                    localStorage.setItem('koreaTravel_checklist', JSON.stringify(newVal));
                },
                deep: true
            },
            person1Name(newVal) {
                localStorage.setItem('koreaTravel_person1Name', newVal);
            },
            person2Name(newVal) {
                localStorage.setItem('koreaTravel_person2Name', newVal);
            },
            tripDays(newVal) {
                // 當行程天數改變時，如果當前選擇的天數不存在，重置為 Day 1
                if (newVal.length > 0 && !newVal.find(d => d.dayNumber === this.selectedDayNumber)) {
                    this.selectedDayNumber = 1;
                }
            }
        }
    });

    app.mount('#app');
}
