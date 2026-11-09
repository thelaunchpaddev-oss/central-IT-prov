const express = require('express');
const cookieSession = require('cookie-session');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();

// Trust Vercel Reverse Proxy
app.set('trust proxy', 1);

// Safe Supabase Client Initialization
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('CRITICAL: SUPABASE_URL or SUPABASE_KEY missing from environment variables.');
}

const supabase = createClient(
    supabaseUrl || 'https://placeholder.supabase.co', 
    supabaseKey || 'placeholder-key'
);

// Safe Temp Storage Directory
const uploadDir = process.env.NODE_ENV === 'production' 
    ? path.join('/tmp', 'uploads') 
    : path.join(__dirname, 'uploads');

try {
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
    }
} catch (e) {
    console.warn('Upload directory skipped.');
}

const upload = multer({ dest: uploadDir, limits: { fileSize: 5 * 1024 * 1024 } });

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'))); 

// Root Route Fallback
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Stateless Cookie Session (Works seamlessly across Vercel Lambdas)
app.use(cookieSession({
    name: 'central_it_session',
    keys: [process.env.SESSION_SECRET || 'central-it-enterprise-secret-key'],
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    httpOnly: true
}));

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: 15,
    message: { error: 'Too many login attempts. Please try again later.' }
});

// Auth Guards
const requireAuth = (req, res, next) => req.session?.user ? next() : res.status(401).json({ error: 'Unauthorized' });
const requireAdmin = (req, res, next) => req.session?.user?.role === 'ADMIN' ? next() : res.status(403).json({ error: 'Admin required.' });

// Public Sites Route
app.get('/api/public/sites', async (req, res) => {
    try {
        const { data, error } = await supabase.from('sites').select('id, site_name').order('site_name', { ascending: true });
        if (error) throw error;
        res.json(data || []);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Auth Routes - Super Admin Session Handling
app.post('/api/login', loginLimiter, async (req, res) => {
    try {
        const email = req.body.email ? req.body.email.trim() : '';
        const password = req.body.password || '';

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required.' });
        }

        let user = null;
        let { data: systemUser, error: sysErr } = await supabase.from('system_users').select('*').eq('email', email).maybeSingle();

        if (systemUser) {
            user = systemUser;
        } else {
            let { data: dbUser, error: usrErr } = await supabase.from('users').select('*').eq('email', email).maybeSingle();
            if (usrErr && sysErr) {
                console.error('Supabase query error:', sysErr || usrErr);
                return res.status(500).json({ error: `Database error: ${(sysErr || usrErr).message}` });
            }
            user = dbUser;
        }

        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials.' });
        }
        
        const match = await bcrypt.compare(password, user.password);
        if (match) {
            // Guarantee Super Admin role for admin@centralit.com or assigned user role
            const assignedRole = (user.email.toLowerCase() === 'admin@centralit.com') ? 'ADMIN' : user.role;

            req.session.user = { id: user.id, name: user.name, role: assignedRole, email: user.email };
            return res.json({ redirect: '/dashboard.html' });
        } else { 
            return res.status(401).json({ error: 'Invalid credentials.' }); 
        }
    } catch (err) { 
        console.error('Login Exception:', err);
        return res.status(500).json({ error: err.message || 'Server connection error.' }); 
    }
});

app.post('/api/logout', (req, res) => { 
    req.session = null;
    res.json({ success: true });
});

app.get('/api/session', requireAuth, (req, res) => res.json(req.session.user));

// Site Routes - Super Admin Allowed Full Creation & Scoping
app.get('/api/sites', requireAuth, async (req, res) => {
    try {
        if (req.session.user.role === 'ADMIN') {
            const { data, error } = await supabase.from('sites').select('*').order('site_name', { ascending: true });
            if (error) throw error;
            res.json(data || []);
        } else {
            const { data, error } = await supabase.from('user_sites').select('sites(*)').eq('user_id', req.session.user.id);
            if (error) throw error;
            const sites = (data || []).map(item => item.sites).filter(Boolean);
            res.json(sites);
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/sites', requireAuth, async (req, res) => {
    if (req.session.user.role !== 'ADMIN' && req.session.user.role !== 'STAFF') {
        return res.status(403).json({ error: 'Access denied. Admin or Staff access required.' });
    }
    try {
        const { data, error } = await supabase.from('sites').insert([{ site_code: req.body.site_code, site_name: req.body.site_name }]).select('id').single();
        if (error) return res.status(400).json({ error: 'Site code must be unique.' });
        
        if (req.session.user.role !== 'ADMIN') {
            await supabase.from('user_sites').insert([{ user_id: req.session.user.id, site_id: data.id }]);
        }

        res.status(201).json({ id: data.id });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/sites/:id', requireAdmin, async (req, res) => {
    try {
        const siteId = parseInt(req.params.id, 10);
        if (isNaN(siteId)) return res.status(400).json({ error: 'Invalid Site ID.' });

        await supabase.from('user_sites').delete().eq('site_id', siteId);
        
        const { error } = await supabase.from('sites').delete().eq('id', siteId);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/sites/:id/assign', requireAuth, async (req, res) => {
    if (req.session.user.role === 'VIEWER') return res.status(403).json({ error: 'Access denied.' });
    try {
        const siteId = parseInt(req.params.id, 10);
        const userId = parseInt(req.body.user_id, 10);
        
        if (isNaN(siteId) || isNaN(userId)) {
            return res.status(400).json({ error: 'Valid user and site IDs are required.' });
        }

        const { data: existing } = await supabase
            .from('user_sites')
            .select('*')
            .eq('user_id', userId)
            .eq('site_id', siteId)
            .maybeSingle();

        if (!existing) {
            const { error: insErr } = await supabase
                .from('user_sites')
                .insert([{ user_id: userId, site_id: siteId }]);
            if (insErr) throw insErr;
        }

        res.json({ success: true });
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.delete('/api/sites/:id/assign', requireAuth, async (req, res) => {
    if (req.session.user.role === 'VIEWER') return res.status(403).json({ error: 'Access denied.' });
    try {
        const siteId = parseInt(req.params.id, 10);
        const userId = parseInt(req.body.user_id, 10);
        
        if (isNaN(siteId) || isNaN(userId)) {
            return res.status(400).json({ error: 'Valid user and site IDs are required.' });
        }

        const { error } = await supabase
            .from('user_sites')
            .delete()
            .eq('site_id', siteId)
            .eq('user_id', userId);

        if (error) throw error;
        res.json({ success: true });
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

// Fetch System Users
app.get('/api/users', requireAdmin, async (req, res) => {
    try {
        let { data, error } = await supabase
            .from('system_users')
            .select('id, name, email, role, user_sites(sites(id, site_code, site_name))');

        if (error || !data || data.length === 0) {
            const fallback = await supabase
                .from('users')
                .select('id, name, email, role, user_sites(sites(id, site_code, site_name))');
            data = fallback.data;
            error = fallback.error;
        }
            
        if (error) throw error;

        const formattedUsers = (data || []).map(u => ({
            id: u.id,
            name: u.name,
            email: u.email,
            role: u.role,
            assignedSites: (u.user_sites || []).map(us => us.sites).filter(Boolean)
        }));

        res.json(formattedUsers);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/users', requireAdmin, async (req, res) => {
    try {
        const hash = await bcrypt.hash(req.body.password, 10);
        
        let targetTable = 'system_users';
        let { data, error } = await supabase.from(targetTable).insert([{ name: req.body.name, email: req.body.email, password: hash, role: req.body.role }]).select('id').single();

        if (error) {
            targetTable = 'users';
            const fallback = await supabase.from(targetTable).insert([{ name: req.body.name, email: req.body.email, password: hash, role: req.body.role }]).select('id').single();
            data = fallback.data;
            error = fallback.error;
        }

        if (error) return res.status(400).json({ error: error.message });

        const parsedSiteId = parseInt(req.body.site_id, 10);
        if (!isNaN(parsedSiteId) && data?.id) {
            await supabase.from('user_sites').insert([{ user_id: data.id, site_id: parsedSiteId }]);
        }

        res.json({ id: data.id });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/users/:id', requireAdmin, async (req, res) => {
    try {
        let { error } = await supabase.from('system_users').update({ name: req.body.name, email: req.body.email, role: req.body.role }).eq('id', parseInt(req.params.id, 10));
        if (error) {
            await supabase.from('users').update({ name: req.body.name, email: req.body.email, role: req.body.role }).eq('id', parseInt(req.params.id, 10));
        }
        res.json({ success: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.put('/api/users/:id/password', requireAdmin, async (req, res) => {
    try {
        const hash = await bcrypt.hash(req.body.password, 10);
        let { error } = await supabase.from('system_users').update({ password: hash }).eq('id', parseInt(req.params.id, 10));
        if (error) {
            await supabase.from('users').update({ password: hash }).eq('id', parseInt(req.params.id, 10));
        }
        res.json({ success: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/users/:id', requireAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.id, 10);
        await supabase.from('user_sites').delete().eq('user_id', userId);
        let { error } = await supabase.from('system_users').delete().eq('id', userId);
        if (error) {
            await supabase.from('users').delete().eq('id', userId);
        }
        res.json({ success: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Assets & Other Routes
app.get('/api/assets', requireAuth, async (req, res) => {
    try {
        let query = supabase.from('assets').select('*, employees(name)');
        const parsedSiteId = parseInt(req.query.site_id, 10);
        if (!isNaN(parsedSiteId)) query = query.eq('site_id', parsedSiteId);
        
        const { data, error } = await query;
        if (error) throw error;

        const formatted = (data || []).map(a => ({
            ...a,
            assignedEmployeeName: a.employees ? a.employees.name : null
        }));
        res.json(formatted);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/assets', requireAuth, async (req, res) => {
    const { assetTag, serialNumber, category, location, model, assignedEmployeeId, warrantyStart, warrantyEnd, site_id } = req.body;
    try {
        const parsedSiteId = parseInt(site_id, 10);
        if (isNaN(parsedSiteId)) return res.status(400).json({ error: 'Valid site_id is required.' });

        const { data, error } = await supabase.from('assets').insert([{
            assetTag, serialNumber, category, location: location || 'Office', model,
            assignedEmployeeId: assignedEmployeeId ? parseInt(assignedEmployeeId, 10) : null,
            warrantyStart: warrantyStart || null, warrantyEnd: warrantyEnd || null,
            status: assignedEmployeeId ? 'Assigned' : 'Unassigned', 
            site_id: parsedSiteId
        }]).select('id').single();
        if (error) return res.status(400).json({ error: error.message });
        res.json({ id: data.id });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/assets/:id', requireAuth, async (req, res) => {
    const { assetTag, serialNumber, category, location, model, assignedEmployeeId, warrantyStart, warrantyEnd, status } = req.body;
    try {
        const { error } = await supabase.from('assets').update({
            assetTag, serialNumber, category, location: location || 'Office', model,
            assignedEmployeeId: assignedEmployeeId ? parseInt(assignedEmployeeId, 10) : null,
            warrantyStart: warrantyStart || null, warrantyEnd: warrantyEnd || null, status
        }).eq('id', parseInt(req.params.id, 10));
        if (error) throw error;
        res.json({ success: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/assets/:id', requireAuth, async (req, res) => {
    try {
        const { error } = await supabase.from('assets').delete().eq('id', parseInt(req.params.id, 10));
        if (error) throw error;
        res.json({ success: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.get('/api/teams', requireAuth, async (req, res) => {
    try {
        const { data, error } = await supabase.from('teams').select('*');
        if (error) throw error;
        res.json(data || []);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/teams', requireAuth, async (req, res) => {
    try {
        const { data, error } = await supabase.from('teams').insert([{ teamName: req.body.teamName, description: req.body.description }]).select('id').single();
        if (error) throw error;
        res.json({ id: data.id });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/employees', requireAuth, async (req, res) => {
    try {
        let query = supabase.from('employees').select('*, teams(teamName)');
        const parsedSiteId = parseInt(req.query.site_id, 10);
        if (!isNaN(parsedSiteId)) query = query.eq('site_id', parsedSiteId);
        
        const { data, error } = await query;
        if (error) throw error;

        const formatted = (data || []).map(e => ({
            ...e,
            teamName: e.teams ? e.teams.teamName : null
        }));
        res.json(formatted);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/employees/:id', requireAuth, async (req, res) => {
    try {
        const empId = parseInt(req.params.id, 10);
        const { data: employee, error: empErr } = await supabase.from('employees').select('*, teams(teamName)').eq('id', empId).single();
        if (empErr) throw empErr;
        const { data: assets, error: astErr } = await supabase.from('assets').select('*').eq('assignedEmployeeId', empId);
        if (astErr) throw astErr;

        res.json({
            employee: { ...employee, teamName: employee.teams ? employee.teams.teamName : null },
            assets: assets || []
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/employees', requireAuth, async (req, res) => {
    try {
        const parsedSiteId = parseInt(req.body.site_id, 10);
        if (isNaN(parsedSiteId)) return res.status(400).json({ error: 'Valid site_id is required.' });

        const { data, error } = await supabase.from('employees').insert([{ 
            name: req.body.name, 
            email: req.body.email, 
            teamId: req.body.teamId ? parseInt(req.body.teamId, 10) : null, 
            site_id: parsedSiteId 
        }]).select('id').single();
        if (error) throw error;
        res.json({ id: data.id });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Bulk Import & Staging
app.get('/api/import/template/:category', requireAdmin, (req, res) => {
    const category = req.params.category;
    let headers = category === 'Laptop' ? [{ 'Category': 'Laptop', 'Asset Tag': 'AST-L101', 'Serial Number': 'SN-99881', 'Model': 'ThinkPad T14', 'Assigned Employee Email': 'john@company.com', 'Warranty Start': '2025-01-01', 'Warranty End': '2028-01-01' }] :
                  category === 'Monitor' ? [{ 'Category': 'Monitor', 'Asset Tag': 'AST-M201', 'Serial Number': 'SN-11223', 'Model': 'Dell UltraSharp', 'Deployment Setup': 'Work From Home', 'Assigned Employee Email': '' }] :
                  [{ 'Category': 'Peripheral', 'Asset Tag': 'AST-P301', 'Serial Number': 'SN-33445', 'Model': 'Logitech Mouse', 'Assigned Employee Email': '' }];
    
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(headers), `${category} Template`);
    const tempFilePath = path.join(uploadDir, `${category}_Template.xlsx`);
    xlsx.writeFile(workbook, tempFilePath);
    res.download(tempFilePath, `${category}_Template.xlsx`, () => { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); });
});

app.post('/api/import/upload', requireAuth, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    try {
        const sheet = xlsx.readFile(req.file.path).Sheets[xlsx.readFile(req.file.path).SheetNames[0]];
        const rows = xlsx.utils.sheet_to_json(sheet);
        const parsedSiteId = parseInt(req.body.site_id, 10);
        
        const stagedEntries = rows.map(row => ({
            assetTag: row['Asset Tag'],
            serialNumber: row['Serial Number'],
            category: row['Category'] || 'Peripheral',
            location: (row['Category'] === 'Monitor' && row['Deployment Setup']) ? row['Deployment Setup'] : 'Office',
            model: row['Model'],
            assignedEmployeeEmail: row['Assigned Employee Email'] || '',
            warrantyStart: row['Warranty Start'] || null,
            warrantyEnd: row['Warranty End'] || null,
            validationStatus: 'Valid',
            site_id: parsedSiteId
        }));

        const { error } = await supabase.from('staged_assets').insert(stagedEntries);
        fs.unlinkSync(req.file.path);
        
        if (error) throw error;
        res.json({ message: 'Rows staged successfully.' });
    } catch (err) { res.status(500).json({ error: 'File parsing error or database insertion fault.' }); }
});

app.get('/api/import/staging', requireAuth, async (req, res) => {
    try {
        const parsedSiteId = parseInt(req.query.site_id, 10);
        const { data, error } = await supabase.from('staged_assets').select('*').eq('site_id', parsedSiteId);
        if (error) throw error;
        res.json(data || []);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/import/staging/:id', requireAuth, async (req, res) => {
    const { assetTag, serialNumber, category, location, model, assignedEmployeeEmail } = req.body;
    try {
        const { error } = await supabase.from('staged_assets').update({ assetTag, serialNumber, category, location, model, assignedEmployeeEmail }).eq('id', parseInt(req.params.id, 10));
        if (error) throw error;
        res.json({ success: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/import/staging/:id', requireAuth, async (req, res) => {
    try {
        const { error } = await supabase.from('staged_assets').delete().eq('id', parseInt(req.params.id, 10));
        if (error) throw error;
        res.json({ success: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/import/staging', requireAuth, async (req, res) => {
    try {
        const parsedSiteId = parseInt(req.query.site_id, 10);
        const { error } = await supabase.from('staged_assets').delete().eq('site_id', parsedSiteId);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/import/commit', requireAuth, async (req, res) => {
    try {
        const parsedSiteId = parseInt(req.body.site_id, 10);
        const { data: stagedRows, error: stgErr } = await supabase.from('staged_assets').select('*').eq('site_id', parsedSiteId).eq('validationStatus', 'Valid');
        if (stgErr) throw stgErr;
        if (!stagedRows || stagedRows.length === 0) return res.status(400).json({ error: 'No valid rows to commit.' });

        const { data: employees, error: empErr } = await supabase.from('employees').select('id, email');
        if (empErr) throw empErr;

        const empMap = new Map((employees || []).map(e => [e.email.toLowerCase(), e.id]));

        const assetsToInsert = stagedRows.map(row => {
            const empId = row.assignedEmployeeEmail ? empMap.get(row.assignedEmployeeEmail.toLowerCase()) || null : null;
            return {
                assetTag: row.assetTag,
                serialNumber: row.serialNumber,
                category: row.category,
                location: row.location || 'Office',
                model: row.model,
                status: empId ? 'Assigned' : 'Unassigned',
                assignedEmployeeId: empId,
                warrantyStart: row.warrantyStart || null,
                warrantyEnd: row.warrantyEnd || null,
                site_id: parsedSiteId
            };
        });

        const { error: insErr } = await supabase.from('assets').insert(assetsToInsert);
        if (insErr) throw insErr;

        await supabase.from('staged_assets').delete().eq('site_id', parsedSiteId);
        res.json({ message: 'Batch successfully committed.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Excel Export
app.get('/api/export', requireAuth, async (req, res) => {
    try {
        let query = supabase.from('assets').select('assetTag, serialNumber, category, model, status, location, warrantyStart, warrantyEnd, employees(name, email)');
        const parsedSiteId = parseInt(req.query.site_id, 10);
        if (!isNaN(parsedSiteId)) query = query.eq('site_id', parsedSiteId);
        
        const { data, error } = await query;
        if (error) throw error;

        const rows = (data || []).map(a => ({
            'Asset Tag': a.assetTag,
            'Serial Number': a.serialNumber,
            'Category': a.category,
            'Model': a.model,
            'Status': a.status,
            'Setup Location': a.location,
            'Assigned To': a.employees ? a.employees.name : 'Unassigned',
            'Assigned Email': a.employees ? a.employees.email : '',
            'Warranty Start': a.warrantyStart || 'N/A',
            'Warranty End': a.warrantyEnd || 'N/A'
        }));

        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(rows), "Live Inventory");
        const exportPath = path.join(uploadDir, `Inventory_Report_${Date.now()}.xlsx`);
        xlsx.writeFile(workbook, exportPath);
        res.download(exportPath, 'Central_IT_Inventory_Report.xlsx', () => { if (fs.existsSync(exportPath)) fs.unlinkSync(exportPath); });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// =========================================================
// ANALYTICS & WARRANTY TRACKING ROUTES (v1.1)
// =========================================================

// Aggregated Model Counts (Scoped by Site)
app.get('/api/analytics/models', requireAuth, async (req, res) => {
    try {
        let query = supabase.from('assets').select('category, model');
        const parsedSiteId = parseInt(req.query.site_id, 10);
        if (!isNaN(parsedSiteId)) query = query.eq('site_id', parsedSiteId);

        const { data, error } = await query;
        if (error) throw error;

        // Group by category and model count
        const modelCounts = (data || []).reduce((acc, item) => {
            const key = `${item.category}:::${item.model || 'Unknown Model'}`;
            if (!acc[key]) {
                acc[key] = { category: item.category, model: item.model || 'Unknown Model', count: 0 };
            }
            acc[key].count += 1;
            return acc;
        }, {});

        res.json(Object.values(modelCounts).sort((a, b) => b.count - a.count));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Laptop Warranty Expiration & Health Pipeline
app.get('/api/analytics/warranty-expirations', requireAuth, async (req, res) => {
    try {
        let query = supabase
            .from('assets')
            .select('id, assetTag, serialNumber, model, warrantyStart, warrantyEnd, employees(name, email)')
            .eq('category', 'Laptop');

        const parsedSiteId = parseInt(req.query.site_id, 10);
        if (!isNaN(parsedSiteId)) query = query.eq('site_id', parsedSiteId);

        const { data, error } = await query;
        if (error) throw error;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const daysThreshold = parseInt(req.query.days || '60', 10);

        const laptopsWithWarranty = (data || []).map(laptop => {
            let status = 'No Warranty Info';
            let daysRemaining = null;

            if (laptop.warrantyEnd) {
                const endDate = new Date(laptop.warrantyEnd);
                const diffTime = endDate - today;
                daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                if (daysRemaining < 0) {
                    status = 'Expired';
                } else if (daysRemaining <= daysThreshold) {
                    status = 'Expiring Soon';
                } else {
                    status = 'Active';
                }
            }

            return {
                ...laptop,
                assignedEmployeeName: laptop.employees ? laptop.employees.name : 'Unassigned',
                daysRemaining,
                warrantyStatus: status
            };
        });

        const summary = {
            totalLaptops: laptopsWithWarranty.length,
            activeCount: laptopsWithWarranty.filter(l => l.warrantyStatus === 'Active').length,
            expiringSoonCount: laptopsWithWarranty.filter(l => l.warrantyStatus === 'Expiring Soon').length,
            expiredCount: laptopsWithWarranty.filter(l => l.warrantyStatus === 'Expired').length,
            noInfoCount: laptopsWithWarranty.filter(l => l.warrantyStatus === 'No Warranty Info').length,
            items: laptopsWithWarranty.sort((a, b) => (a.daysRemaining ?? 9999) - (b.daysRemaining ?? 9999))
        };

        res.json(summary);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Local Development Server Listener
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Server running locally on port ${PORT}`));
}

module.exports = app;