// Keys are now loaded from config.js
const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);

// State Management
let currentTab = 'home';
let charts = {};
let allOrders = [];
let menuItems = [];
let categories = [];
let waiters = [];
let settings = {
    res_name: "Book My Dine",
    res_address: "",
    res_gstin: "",
    res_upi: "",
    res_tax_rate: 5
};

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const adminInterface = document.getElementById('admin-interface');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const navItems = document.querySelectorAll('.nav-item');
const tabSections = document.querySelectorAll('.tab-section');
const tabTitle = document.getElementById('tab-title');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    checkSession();
    setupAuth();
    setupNav();
    setupFilters();
    setupModals();
    setupSettingsForm();
});

async function checkSession() {
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
        const { data: profile } = await sb.from('profiles').select('role, name').eq('id', session.user.id).maybeSingle();
        if (profile && profile.role === 'admin') {
            showInterface(profile.name);
        } else {
            await sb.auth.signOut();
            showLogin();
            if (profile) loginError.textContent = "Access denied. Admin only.";
        }
    } else {
        showLogin();
    }
}

function setupAuth() {
    loginForm.onsubmit = async (e) => {
        e.preventDefault();
        loginError.textContent = "Logging in...";
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;

        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) {
            loginError.textContent = error.message;
            return;
        }
        
        const { data: profile } = await sb.from('profiles').select('role, name').eq('id', data.user.id).maybeSingle();
        if (profile && profile.role === 'admin') {
            showInterface(profile.name);
        } else {
            await sb.auth.signOut();
            loginError.textContent = "Access denied. Admin only.";
        }
    };

    
    // Password Toggle Logic
    const toggleBtn = document.getElementById('toggle-password');
    const passwordInput = document.getElementById('login-password');
    
    if(toggleBtn && passwordInput) {
        toggleBtn.addEventListener('click', () => {
            const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
            passwordInput.setAttribute('type', type);
            toggleBtn.src = type === 'password' ? 'hide.png' : 'show.png';
        });
    }
}

function showLogin() {
    loginScreen.style.display = 'flex';
    adminInterface.style.display = 'none';
}

function showInterface(name) {
    loginScreen.style.display = 'none';
    adminInterface.style.display = 'flex';
    document.getElementById('admin-name').textContent = name || 'Admin';
    initApp();
}

async function initApp() {
    await loadSettings();
    loadDashboard();
    loadOrders();
    loadMenu();
    loadWaiters();
    setupRealtime();
}

// Navigation Logic
function setupNav() {
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const tab = item.getAttribute('data-tab');
            switchTab(tab);
        });
    });
}

function switchTab(tab) {
    navItems.forEach(i => i.classList.toggle('active', i.getAttribute('data-tab') === tab));
    tabSections.forEach(s => s.classList.toggle('active', s.id === `${tab}-tab`));
    
    const titles = {
        'home': 'Home',
        'daily-sales': 'Daily Sales Visualization',
        'orders': 'Orders & Invoices',
        'customers': 'Bill Contacts',
        'monthly': 'Monthly Report',
        'yearly': 'Yearly Report',
        'waiter-status': 'Waiter Status',
        'menu': 'Menu Management',
        'settings': 'Settings'
    };
    tabTitle.textContent = titles[tab] || 'Dashboard';
    currentTab = tab;
    
    // Tab specific initializations
    if (tab === 'home') {
        loadDashboard();
        // Force chart resize/update if it exists
        if (charts.hourly) {
            setTimeout(() => charts.hourly.resize(), 50);
        }
    }
    if (tab === 'daily-sales') initDailyChart();
    if (tab === 'monthly') initMonthlyTab();
    if (tab === 'yearly') initYearlyTab();
}

// Realtime Sync
function setupRealtime() {
    sb.channel('admin_all_changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
            refreshData();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
            loadWaiters();
            loadDashboard();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items' }, () => {
            loadMenu();
        })
        .subscribe();
}

function refreshData() {
    loadDashboard();
    loadOrders();
    if (currentTab === 'daily-sales') initDailyChart();
    if (currentTab === 'monthly') initMonthlyTab();
    if (currentTab === 'yearly') initYearlyTab();
    if (currentTab === 'customers') renderCustomersTable();
}

// Tab 1: Home (Overview)
async function loadDashboard() {
    try {
        console.log("Loading dashboard...");
        const today = new Date();
        today.setHours(0,0,0,0);
        const todayStr = today.toISOString();
        console.log("Filtering from:", todayStr);

        const { data: orders, error: ordersError } = await sb.from('orders')
            .select('*')
            .gte('created_at', todayStr);
        
        if (ordersError) {
            console.error("Dashboard Orders Error:", ordersError);
            return;
        }

        console.log("Orders found today:", orders?.length);

        const { data: onlineWaiters, error: waitersError } = await sb.from('profiles')
            .select('id')
            .eq('role', 'waiter')
            .eq('status', 'online');
        
        if (waitersError) console.error("Dashboard Waiters Error:", waitersError);

        const { data: activeTables, error: tablesError } = await sb.from('tables')
            .select('id')
            .eq('status', 'occupied');
        
        if (tablesError) console.error("Dashboard Tables Error:", tablesError);

        const paidOrders = orders?.filter(o => o.status === 'paid') || [];
        const sales = paidOrders.reduce((sum, o) => sum + Number(o.grand_total || 0), 0);
        const bills = orders?.length || 0;
        const tax = paidOrders.reduce((sum, o) => sum + Number(o.tax || 0), 0);
        const activeTablesCount = activeTables?.length || 0;
        const waitersCount = onlineWaiters?.length || 0;

        // Update UI
        const salesEl = document.getElementById('dash-sales');
        const ordersEl = document.getElementById('dash-orders');
        const taxEl = document.getElementById('dash-tax');
        const tablesEl = document.getElementById('dash-tables');
        const waitersEl = document.getElementById('dash-waiters');

        if (salesEl) salesEl.textContent = `₹${sales.toLocaleString('en-IN')}`;
        if (ordersEl) ordersEl.textContent = bills;
        if (taxEl) taxEl.textContent = `₹${tax.toLocaleString('en-IN')}`;
        if (tablesEl) tablesEl.textContent = activeTablesCount;
        if (waitersEl) waitersEl.textContent = waitersCount;

        // Auto-load graph
        if (orders) {
            initHourlyChart(orders);
        }
        
        // Refresh recent activity
        renderRecentActivity(orders || []);

    } catch (err) {
        console.error("loadDashboard Exception:", err);
    }
}

function renderRecentActivity(orders) {
    const list = document.getElementById('recent-activity-list');
    if (!list) return;
    
    const recent = [...orders]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 10);
        
    list.innerHTML = recent.map(o => `
        <div class="activity-item">
            <div class="activity-info">
                <span class="activity-time">${new Date(o.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                <span class="activity-desc">Order <strong>${o.bill_number || '#' + o.invoice_number}</strong> - ₹${Number(o.grand_total).toFixed(0)}</span>
            </div>
            <span class="status-dot status-${o.status}"></span>
        </div>
    `).join('') || '<p class="text-muted">No activity today</p>';
}

async function initHourlyChart(orders) {
    try {
        const hourlyData = new Array(24).fill(0);
        orders.forEach(o => {
            if (o.status === 'paid') {
                const date = new Date(o.created_at);
                const hour = date.getHours();
                hourlyData[hour] += Number(o.grand_total || 0);
            }
        });

        const canvas = document.getElementById('hourlySalesChart');
        if (!canvas) return;
        
        // Ensure parent is visible for chart to calculate size
        if (canvas.offsetParent === null) {
            // If hidden, try again when tab becomes active
            return;
        }

        const ctx = canvas.getContext('2d');
        if (charts.hourly) {
            charts.hourly.data.datasets[0].data = hourlyData;
            charts.hourly.update();
        } else {
            charts.hourly = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: Array.from({length: 24}, (_, i) => `${i}:00`),
                    datasets: [{
                        label: 'Sales (₹)',
                        data: hourlyData,
                        backgroundColor: 'rgba(74, 144, 226, 0.7)',
                        hoverBackgroundColor: '#4a90e2',
                        borderRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: (ctx) => `Sales: ₹${ctx.raw.toLocaleString()}`
                            }
                        }
                    },
                    scales: {
                        y: { 
                            beginAtZero: true,
                            grid: { color: '#f0f0f0' },
                            ticks: { font: { size: 10 } }
                        },
                        x: {
                            grid: { display: false },
                            ticks: { font: { size: 10 } }
                        }
                    }
                }
            });
        }
    } catch (err) {
        console.error("initHourlyChart Error:", err);
    }
}

// Tab 2: Daily Sales (Visualization)
async function initDailyChart() {
    try {
        console.log("Initializing Daily Chart...");
        const today = new Date();
        today.setHours(0,0,0,0);
        const todayStr = today.toISOString();

        const { data: orders, error } = await sb.from('orders')
            .select('*')
            .gte('created_at', todayStr);
        
        if (error) throw error;

        const hourlyData = new Array(24).fill(0);
        orders?.forEach(o => {
            if (o.status === 'paid') {
                const hour = new Date(o.created_at).getHours();
                hourlyData[hour] += Number(o.grand_total || 0);
            }
        });

        const paidOrders = orders?.filter(o => o.status === 'paid') || [];
        const sales = paidOrders.reduce((sum, o) => sum + Number(o.grand_total || 0), 0);
        const bills = orders?.length || 0;
        const avg = bills > 0 ? (sales / bills) : 0;

        console.log("Daily Stats:", { sales, bills, avg });

        const salesEl = document.getElementById('daily-total-sales');
        const billsEl = document.getElementById('daily-total-bills');
        const avgEl = document.getElementById('daily-avg-bill');

        if (salesEl) salesEl.textContent = `₹${sales.toLocaleString('en-IN')}`;
        if (billsEl) billsEl.textContent = bills;
        if (avgEl) avgEl.textContent = `₹${avg.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

        const chartEl = document.getElementById('dailySalesChart');
        if (!chartEl) {
            console.warn("dailySalesChart canvas not found");
            return;
        }
        
        const ctx = chartEl.getContext('2d');
        if (charts.daily) charts.daily.destroy();

        // Show 24 hours to be safe
        charts.daily = new Chart(ctx, {
            type: 'line',
            data: {
                labels: Array.from({length: 24}, (_, i) => `${i}:00`),
                datasets: [{
                    label: 'Sales (₹)',
                    data: hourlyData,
                    borderColor: '#4a90e2',
                    backgroundColor: 'rgba(74, 144, 226, 0.1)',
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true } }
            }
        });
    } catch (err) {
        console.error("initDailyChart Error:", err);
    }
}

// Tab 3: Orders & Invoices
async function loadOrders() {
    const dateFilter = document.getElementById('order-date-filter').value;
    const payFilter = document.getElementById('payment-filter').value;
    const waiterFilter = document.getElementById('waiter-filter').value;

    let query = sb.from('orders').select(`
        *,
        profiles:waiter_id(name),
        tables:table_id(table_number)
    `).order('created_at', { ascending: false });

    if (dateFilter) {
        query = query.gte('created_at', `${dateFilter}T00:00:00Z`).lte('created_at', `${dateFilter}T23:59:59Z`);
    }

    if (payFilter !== 'all') query = query.eq('payment_mode', payFilter);
    if (waiterFilter !== 'all') query = query.eq('waiter_id', waiterFilter);

    const { data, error } = await query;
    if (error) return;

    allOrders = data;
    renderOrdersTable(data);
    if (currentTab === 'customers') renderCustomersTable();
}

function renderOrdersTable(orders) {
    const tbody = document.getElementById('orders-body');
    tbody.innerHTML = orders.map(o => `
        <tr>
            <td><strong>${o.bill_number || '#' + o.invoice_number}</strong></td>
            <td>${new Date(o.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td>
            <td>Table ${o.tables?.table_number || 'N/A'}</td>
            <td>${o.profiles?.name || 'N/A'}</td>
            <td>${o.payment_mode || '-'}</td>
            <td>₹${Number(o.grand_total).toFixed(2)}</td>
            <td><span class="status-badge status-${o.status}">${o.status.toUpperCase()}</span></td>
            <td>
                <button class="btn-secondary btn-sm" onclick="viewOrderDetails('${o.id}')">View</button>
            </td>
        </tr>
    `).join('');
}

// Tab 4: Customer Contacts
function renderCustomersTable() {
    const tbody = document.getElementById('customers-body');
    tbody.innerHTML = allOrders.map(o => `
        <tr>
            <td>${o.bill_number || o.invoice_number}</td>
            <td>${new Date(o.created_at).toLocaleDateString()}</td>
            <td>${o.customer_name || 'Guest'}</td>
            <td>${o.customer_mobile || 'NA'}</td>
            <td>${o.customer_email || 'NA'}</td>
            <td>₹${Number(o.grand_total).toFixed(2)}</td>
        </tr>
    `).join('');
}

// Tab 5: Monthly Report
async function initMonthlyTab() {
    const picker = document.getElementById('monthly-month-picker');
    if (!picker.value) picker.value = new Date().toISOString().slice(0, 7);
    
    const [year, month] = picker.value.split('-');
    const startDate = new Date(year, month - 1, 1).toISOString();
    const endDate = new Date(year, month, 0, 23, 59, 59).toISOString();

    const { data: orders } = await sb.from('orders')
        .select('*')
        .gte('created_at', startDate)
        .lte('created_at', endDate)
        .eq('status', 'paid');

    const sales = orders?.reduce((sum, o) => sum + Number(o.grand_total), 0) || 0;
    const bills = orders?.length || 0;
    const tax = orders?.reduce((sum, o) => sum + Number(o.tax), 0) || 0;

    document.getElementById('monthly-sales').textContent = `₹${sales.toLocaleString()}`;
    document.getElementById('monthly-bills').textContent = bills;
    document.getElementById('monthly-tax').textContent = `₹${tax.toLocaleString()}`;

    // Chart: Day-wise sales
    const daysInMonth = new Date(year, month, 0).getDate();
    const dailyData = new Array(daysInMonth).fill(0);
    orders?.forEach(o => {
        const day = new Date(o.created_at).getDate();
        dailyData[day - 1] += Number(o.grand_total);
    });

    const ctx = document.getElementById('monthlyChart').getContext('2d');
    if (charts.monthly) charts.monthly.destroy();
    charts.monthly = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: Array.from({length: daysInMonth}, (_, i) => i + 1),
            datasets: [{
                label: 'Daily Sales (₹)',
                data: dailyData,
                backgroundColor: '#50c878'
            }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

// Tab 6: Yearly Report
async function initYearlyTab() {
    const picker = document.getElementById('yearly-year-picker');
    if (!picker.options.length) {
        const currentYear = new Date().getFullYear();
        for (let y = currentYear; y >= currentYear - 5; y--) {
            const opt = document.createElement('option');
            opt.value = y;
            opt.textContent = y;
            picker.appendChild(opt);
        }
    }

    const year = picker.value;
    const startDate = new Date(year, 0, 1).toISOString();
    const endDate = new Date(year, 11, 31, 23, 59, 59).toISOString();

    const { data: orders } = await sb.from('orders')
        .select('*')
        .gte('created_at', startDate)
        .lte('created_at', endDate)
        .eq('status', 'paid');

    const sales = orders?.reduce((sum, o) => sum + Number(o.grand_total), 0) || 0;
    const bills = orders?.length || 0;
    const tax = orders?.reduce((sum, o) => sum + Number(o.tax), 0) || 0;

    document.getElementById('yearly-sales').textContent = `₹${sales.toLocaleString()}`;
    document.getElementById('yearly-bills').textContent = bills;
    document.getElementById('yearly-tax').textContent = `₹${tax.toLocaleString()}`;

    const monthlyData = new Array(12).fill(0);
    orders?.forEach(o => {
        const month = new Date(o.created_at).getMonth();
        monthlyData[month] += Number(o.grand_total);
    });

    const ctx = document.getElementById('yearlyChart').getContext('2d');
    if (charts.yearly) charts.yearly.destroy();
    charts.yearly = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
            datasets: [{
                label: 'Monthly Sales (₹)',
                data: monthlyData,
                borderColor: '#4a90e2',
                tension: 0.4,
                fill: false
            }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

// Tab 7: Waiter Status
async function loadWaiters() {
    const { data: waitersData } = await sb.from('profiles')
        .select(`*, tables:active_table_id(table_number)`)
        .eq('role', 'waiter')
        .order('name');

    const { data: activeOrders } = await sb.from('orders').select('waiter_id').eq('status', 'open');
    const orderCounts = {};
    activeOrders?.forEach(o => orderCounts[o.waiter_id] = (orderCounts[o.waiter_id] || 0) + 1);

    const tbody = document.getElementById('waiters-body');
    tbody.innerHTML = (waitersData || []).map(w => `
        <tr>
            <td><strong>${w.name}</strong></td>
            <td>
                <span class="status-indicator ${w.status}"></span>
                ${w.status.toUpperCase()}
            </td>
            <td>${w.tables?.table_number ? 'Table ' + w.tables.table_number : 'None'}</td>
            <td>${orderCounts[w.id] || 0}</td>
            <td>${w.last_active_at ? new Date(w.last_active_at).toLocaleTimeString() : 'Never'}</td>
        </tr>
    `).join('');

    // Update filters
    const waiterFilter = document.getElementById('waiter-filter');
    const currentVal = waiterFilter.value;
    waiterFilter.innerHTML = '<option value="all">All Waiters</option>' + 
        waitersData.map(w => `<option value="${w.id}">${w.name}</option>`).join('');
    waiterFilter.value = currentVal;
}

// Tab 8: Menu Management
async function loadMenu() {
    const { data } = await sb.from('menu_items').select('*').order('category', { ascending: true });
    menuItems = data || [];
    categories = [...new Set(menuItems.map(item => item.category))];
    
    const catFilter = document.getElementById('menu-category-filter');
    catFilter.innerHTML = '<option value="all">All Categories</option>' + 
        categories.map(c => `<option value="${c}">${c}</option>`).join('');
    
    document.getElementById('category-suggestions').innerHTML = categories.map(c => `<option value="${c}">`).join('');
    renderMenu();
}

function renderMenu() {
    const cat = document.getElementById('menu-category-filter').value;
    const container = document.getElementById('menu-container');
    const filtered = cat === 'all' ? menuItems : menuItems.filter(i => i.category === cat);
    
    container.innerHTML = filtered.map(item => `
        <div class="menu-card ${!item.is_active ? 'disabled' : ''}">
            <div class="menu-header">
                <span class="category-tag">${item.category}</span>
                <button class="btn-edit" onclick="editMenuItem('${item.id}')">✏️</button>
            </div>
            <h4>${item.name}</h4>
            <div class="price">₹${item.price}</div>
            <div class="item-meta">Tax: ${item.tax_rate}% | ${item.is_active ? 'Active' : 'Disabled'}</div>
        </div>
    `).join('');
}

// Tab 9: Settings
async function loadSettings() {
    const { data } = await sb.from('restaurant_settings').select('*').single();
    if (data) {
        settings = data;
        document.getElementById('res-name').value = data.res_name;
        document.getElementById('res-address').value = data.res_address;
        document.getElementById('res-gstin').value = data.res_gstin;
        document.getElementById('res-upi').value = data.res_upi;
        document.getElementById('res-tax-rate').value = data.res_tax_rate;
    }
}

function setupSettingsForm() {
    document.getElementById('settings-form').onsubmit = async (e) => {
        e.preventDefault();
        const data = {
            res_name: document.getElementById('res-name').value,
            res_address: document.getElementById('res-address').value,
            res_gstin: document.getElementById('res-gstin').value,
            res_upi: document.getElementById('res-upi').value,
            res_tax_rate: Number(document.getElementById('res-tax-rate').value)
        };
        const { error } = await sb.from('restaurant_settings').upsert({ id: 1, ...data });
        if (error) alert("Error saving settings: " + error.message);
        else alert("Settings saved successfully!");
    };
}

// Export Logic
document.getElementById('btn-export-monthly').onclick = () => exportReport('monthly');
document.getElementById('btn-export-yearly').onclick = () => exportReport('yearly');

async function exportReport(period) {
    const loading = document.getElementById('export-loading');
    loading.style.display = 'flex';

    try {
        let orders = [];
        let filename = "";
        const withCustomerData = document.getElementById(`${period}-export-type`).value === 'with';

        if (period === 'monthly') {
            const picker = document.getElementById('monthly-month-picker');
            const [year, month] = picker.value.split('-');
            const startDate = new Date(year, month - 1, 1).toISOString();
            const endDate = new Date(year, month, 0, 23, 59, 59).toISOString();
            const { data } = await sb.from('orders').select(`*, profiles:waiter_id(name)`).gte('created_at', startDate).lte('created_at', endDate).eq('status', 'paid');
            orders = data || [];
            filename = `Monthly_Report_${picker.value}.xlsx`;
        } else {
            const year = document.getElementById('yearly-year-picker').value;
            const startDate = new Date(year, 0, 1).toISOString();
            const endDate = new Date(year, 11, 31, 23, 59, 59).toISOString();
            const { data } = await sb.from('orders').select(`*, profiles:waiter_id(name)`).gte('created_at', startDate).lte('created_at', endDate).eq('status', 'paid');
            orders = data || [];
            filename = `Yearly_Report_${year}.xlsx`;
        }

        const headers = period === 'monthly' ? 
            ["Bill No", "Date", "Table No", "Waiter", "Payment Mode", "Subtotal", "Discount", "SGST", "CGST", "Final Amount"] :
            ["Bill No", "Date", "Month", "Payment Mode", "Total Amount", "Tax (SGST+CGST)", "Waiter"];

        if (withCustomerData) headers.push("Customer Name", "Mobile", "Email");

        const ws_data = [headers];

        orders.forEach(o => {
            const date = new Date(o.created_at);
            const taxHalf = Number(o.tax) / 2;
            
            let row = [];
            if (period === 'monthly') {
                row = [o.bill_number, date.toLocaleDateString(), o.table_id || 'N/A', o.profiles?.name || 'N/A', o.payment_mode, o.subtotal, o.discount, taxHalf, taxHalf, o.grand_total];
            } else {
                row = [o.bill_number, date.toLocaleDateString(), date.toLocaleString('default', { month: 'long' }), o.payment_mode, o.grand_total, o.tax, o.profiles?.name || 'N/A'];
            }

            if (withCustomerData) {
                row.push(o.customer_name || 'Guest', o.customer_mobile || 'NA', o.customer_email || 'NA');
            }
            ws_data.push(row);
        });

        const ws = XLSX.utils.aoa_to_sheet(ws_data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Sales Report");
        XLSX.writeFile(wb, filename);
    } catch (err) {
        alert("Export failed: " + err.message);
    } finally {
        loading.style.display = 'none';
    }
}

// Bill Modals & Actions
async function viewOrderDetails(orderId) {
    try {
        const { data: o, error } = await sb.from('orders')
            .select('*, order_items(*, menu_items(name)), profiles:waiter_id(name), tables:table_id(table_number)')
            .eq('id', orderId)
            .single();

        if (error || !o) {
            console.error("Error fetching order details:", error);
            return;
        }

        const content = document.getElementById('bill-details-content');
        
        // Calculate item totals
        const itemsHtml = o.order_items.map(i => {
            const itemName = i.menu_items?.name || 'Item';
            const itemTotal = Number(i.price_at_time || 0) * Number(i.quantity || 0);
            return `
                <tr>
                    <td style="padding: 5px 0;">${itemName}</td>
                    <td align="center">${i.quantity}</td>
                    <td align="right">₹${itemTotal.toFixed(2)}</td>
                </tr>
            `;
        }).join('');

        const taxTotal = Number(o.tax || 0);
        const taxHalf = taxTotal / 2;

        content.innerHTML = `
            <div style="text-align: center; margin-bottom: 20px;">
                <h2 style="margin: 0; font-size: 1.5rem; text-transform: uppercase;">${settings.res_name}</h2>
                <p style="margin: 5px 0; font-size: 0.85rem;">${settings.res_address}</p>
                ${settings.res_gstin ? `<p style="margin: 2px 0; font-size: 0.85rem;">GSTIN: ${settings.res_gstin}</p>` : ''}
                <div style="border-top: 1px dashed #333; margin: 10px 0;"></div>
                <h3 style="margin: 5px 0; font-size: 1rem;">BILL NO: ${o.bill_number || '#' + o.invoice_number}</h3>
            </div>

            <div style="margin-bottom: 15px; font-size: 0.9rem; line-height: 1.4;">
                <div style="display: flex; justify-content: space-between;">
                    <span><strong>Table:</strong> ${o.tables?.table_number || 'N/A'}</span>
                    <span><strong>Date:</strong> ${new Date(o.created_at).toLocaleDateString()}</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span><strong>Waiter:</strong> ${o.profiles?.name || 'N/A'}</span>
                    <span><strong>Time:</strong> ${new Date(o.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                </div>
                <p style="margin: 3px 0;"><strong>Customer:</strong> ${o.customer_name || 'Guest'}</p>
            </div>

            <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 0.9rem;">
                <thead>
                    <tr style="border-bottom: 1px dashed #333; border-top: 1px dashed #333;">
                        <th align="left" style="padding: 8px 0;">ITEM</th>
                        <th align="center" style="padding: 8px 0;">QTY</th>
                        <th align="right" style="padding: 8px 0;">PRICE</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsHtml}
                </tbody>
            </table>

            <div style="border-top: 1px dashed #333; padding-top: 10px; font-size: 0.95rem;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                    <span>Subtotal:</span>
                    <span>₹${Number(o.subtotal || 0).toFixed(2)}</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                    <span>SGST (2.5%):</span>
                    <span>₹${taxHalf.toFixed(2)}</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                    <span>CGST (2.5%):</span>
                    <span>₹${taxHalf.toFixed(2)}</span>
                </div>
                ${Number(o.discount || 0) > 0 ? `
                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                    <span>Discount:</span>
                    <span>-₹${Number(o.discount).toFixed(2)}</span>
                </div>` : ''}
                <div style="display: flex; justify-content: space-between; margin-top: 10px; padding-top: 10px; border-top: 1px solid #333; font-size: 1.2rem; font-weight: bold;">
                    <span>TOTAL:</span>
                    <span>₹${Number(o.grand_total || 0).toFixed(2)}</span>
                </div>
                <p style="margin-top: 10px; font-size: 0.8rem; font-style: italic; text-align: center;">
                    Payment Mode: ${o.payment_mode || 'N/A'}
                </p>
            </div>

            <div style="text-align: center; margin-top: 25px; border-top: 1px dashed #333; padding-top: 15px;">
                <p style="margin: 0; font-weight: bold; font-size: 1.1rem;">THANK YOU! VISIT AGAIN</p>
                ${settings.res_upi ? `<p style="margin: 8px 0 0; font-size: 0.85rem;">Pay via UPI: ${settings.res_upi}</p>` : ''}
            </div>
        `;
        
        document.getElementById('order-details-modal').style.display = 'block';
    } catch (err) {
        console.error("viewOrderDetails Exception:", err);
    }
}

// Modal closing
function setupModals() {
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
        };
    });

    // Print Action
    const printBtn = document.querySelector('.btn-print');
    if (printBtn) {
        printBtn.onclick = () => {
            window.print();
        };
    }
}

// Menu Actions
async function editMenuItem(id) {
    const item = menuItems.find(i => i.id === id);
    if (!item) return;
    document.getElementById('menu-modal-title').textContent = 'Edit Menu Item';
    document.getElementById('menu-item-id').value = item.id;
    document.getElementById('menu-name').value = item.name;
    document.getElementById('menu-category').value = item.category;
    document.getElementById('menu-price').value = item.price;
    document.getElementById('menu-tax').value = item.tax_rate;
    document.getElementById('menu-active').checked = item.is_active;
    document.getElementById('menu-modal').style.display = 'block';
}

document.getElementById('menu-form').onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('menu-item-id').value;
    const data = {
        name: document.getElementById('menu-name').value,
        category: document.getElementById('menu-category').value,
        price: Number(document.getElementById('menu-price').value),
        tax_rate: Number(document.getElementById('menu-tax').value),
        is_active: document.getElementById('menu-active').checked
    };
    if (id) await sb.from('menu_items').update(data).eq('id', id);
    else await sb.from('menu_items').insert(data);
    document.getElementById('menu-modal').style.display = 'none';
    loadMenu();
};

function setupFilters() {
    document.getElementById('order-date-filter').addEventListener('change', loadOrders);
    document.getElementById('payment-filter').addEventListener('change', loadOrders);
    document.getElementById('waiter-filter').addEventListener('change', loadOrders);
    document.getElementById('menu-category-filter').addEventListener('change', renderMenu);
    document.getElementById('monthly-month-picker').addEventListener('change', initMonthlyTab);
    document.getElementById('yearly-year-picker').addEventListener('change', initYearlyTab);
}

// Auth Footer
document.getElementById('admin-logout').onclick = async () => {
    await sb.auth.signOut();
    location.reload();
};
