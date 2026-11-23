import asyncio, re
from playwright.async_api import async_playwright
B='http://localhost:3111'; S='/home/claude/shots/'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        cx = await b.new_context(viewport={'width':1440,'height':900}); pg = await cx.new_page(); pg.set_default_timeout(60000)
        errs=[]; pg.on('console', lambda m: errs.append(m.text[:200]) if m.type=='error' else None); pg.on('pageerror', lambda e: errs.append('PAGEERR '+str(e)[:300]))
        pg.on('dialog', lambda d: asyncio.ensure_future(d.accept('testing') if d.type=='prompt' else d.accept()))
        async def dlg(): return pg.locator('dialog[open]')
        async def save(text):
            d = await dlg(); await d.get_by_role('button', name=text, exact=True).click(); await pg.wait_for_selector('dialog[open]', state='detached'); await pg.wait_for_load_state('networkidle')
        await pg.goto(B+'/', wait_until='networkidle')
        await pg.fill('#company','Hawthorn Homes LLC'); await pg.fill('#name','Sam Builder'); await pg.fill('#email','sam@example.com'); await pg.fill('#password','correct-horse-9'); await pg.click('button.btn-primary'); await pg.wait_for_url(B+'/')
        # client, vendor
        await pg.goto(B+'/clients', wait_until='networkidle'); await pg.get_by_role('button', name='New client').click(); await pg.fill('#f-name','Jordan & Casey Rivera'); await pg.fill('#f-email','rivera@example.com'); await save('Save')
        await pg.goto(B+'/vendors', wait_until='networkidle'); await pg.get_by_role('button', name='New vendor').click(); await pg.fill('#f-name','Brightline Electric'); await pg.fill('#f-trade','Electrical'); await pg.fill('#f-address','410 Circuit Rd\nAnkeny, IA 50023'); await pg.fill('#f-taxId','12-3456789'); await pg.check('input[name=requiresWaiver]'); await save('Save')
        # project
        await pg.goto(B+'/projects', wait_until='networkidle'); await pg.get_by_role('button', name='New project').click()
        await pg.fill('#f-name','1420 Maple Street'); await pg.fill('#f-address','1420 Maple St, Ankeny, IA'); await pg.select_option('#f-clientId', label='Jordan & Casey Rivera'); await pg.fill('#f-budget','310000'); await pg.fill('#f-contractPrice','425000'); await pg.fill('#f-startDate','2026-08-03'); await (await dlg()).get_by_role('button', name='Save', exact=True).click()
        await pg.wait_for_url(re.compile('/projects/\\d+')); proj = pg.url
        # bill with upload
        open('/tmp/inv.pdf','wb').write(b'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF')
        async def add_bill(vendor, no, cat, amt, paid=False, newv=None):
            await pg.get_by_role('button', name='Add bill or expense').click(); d = await dlg()
            if no=='BE-1001': await d.locator('input[type=file]').set_input_files('/tmp/inv.pdf'); await d.get_by_text('inv.pdf').wait_for()
            sels = d.locator('select')
            await sels.nth(1).select_option(label=vendor) if not newv else await sels.nth(1).select_option('new')
            if newv: await d.get_by_placeholder('New vendor name').fill(newv)
            await d.locator('input').nth(1 if not newv else 2).fill(no) if False else None
            await d.get_by_label('Category').select_option(label=cat); await d.get_by_label('Amount').fill(amt)
            await d.locator('input[type=date]').first.fill('2026-11-02')
            if paid:
                await d.get_by_text('Already paid').click(); await d.get_by_label('Paid from').select_option(index=2)
            await d.get_by_role('button', name=re.compile('Save as')).click(); await pg.wait_for_selector('dialog[open]', state='detached'); await pg.wait_for_load_state('networkidle')
        await add_bill('Brightline Electric','BE-1001','Electrical','18450.00')
        await add_bill(None,'x','Framing','42310.55', paid=True, newv='Prairie Lumber Co')
        await pg.goto(proj+'/ledger', wait_until='networkidle'); await pg.screenshot(path=S+'ledger.png', full_page=True)
        # check
        await pg.get_by_role('button', name='Write check').click(); d = await dlg(); await d.get_by_text('Pay to').locator('..').locator('select').select_option(label='Brightline Electric'); await d.locator('tbody input[type=checkbox]').check(); await d.get_by_placeholder('').first.is_visible()
        await d.get_by_role('button', name='Create draft check').click(); await pg.wait_for_url(re.compile('/checks/\\d+')); await pg.wait_for_load_state('networkidle'); chk = pg.url
        r = await cx.request.get(chk.replace('/checks/','/api/checks/')+'/pdf'); open(S+'check.pdf','wb').write(await r.body()); print('check pdf', r.status, len(await r.body()))
        await pg.reload(wait_until='networkidle'); await pg.get_by_role('button', name='Record as issued').click(); await pg.get_by_text('Issued and outstanding').wait_for(); await pg.screenshot(path=S+'check.png', full_page=True)
        # opening balance + invoice + reconcile
        await pg.goto(B+'/settings?tab=bank', wait_until='networkidle'); await pg.get_by_role('button', name='Opening balance').click(); await pg.fill('#f-amount','250000'); await pg.fill('#f-date','2026-10-01'); await save('Save'); await pg.screenshot(path=S+'bank.png', full_page=True)
        await pg.goto(B+'/invoices', wait_until='networkidle'); await pg.get_by_role('button', name='New client invoice').click(); d = await dlg(); await d.locator('select').nth(1).select_option(index=1); await d.get_by_placeholder('Description').fill('Construction draw #1 — foundation complete'); await d.get_by_placeholder('Unit price').fill('85000')
        await d.get_by_role('button', name='Create invoice').click(); await pg.wait_for_url(re.compile('/invoices/\\d+')); await pg.wait_for_load_state('networkidle'); inv = pg.url
        await pg.get_by_role('button', name='Record payment received').click(); await pg.fill('#f-amount','50000'); await pg.select_option('#f-accountId', index=1); await save('Save'); await pg.screenshot(path=S+'invoice.png', full_page=True)
        r = await cx.request.get(inv.replace('/invoices/','/api/invoices/')+'/pdf'); open(S+'invoice.pdf','wb').write(await r.body())
        await pg.goto(B+'/checks/reconcile', wait_until='networkidle'); await pg.get_by_role('button', name='Reconcile a statement').click(); await pg.fill('#f-statementDate','2026-11-30'); await pg.fill('#f-endingBalance','281550.00'); await (await dlg()).get_by_role('button', name='Save', exact=True).click(); await pg.wait_for_url(re.compile('/reconcile/\\d+')); await pg.locator('tbody input[type=checkbox]').first.wait_for()
        n = await pg.locator('tbody input[type=checkbox]').count(); print('recon items', n)
        for i in range(n):
            await pg.locator('tbody input[type=checkbox]').nth(i).check(); await pg.wait_for_timeout(700)
        await pg.wait_for_load_state('networkidle'); await pg.screenshot(path=S+'recon.png', full_page=True)
        await pg.get_by_text('Balanced').wait_for(); await pg.get_by_role('button', name='Finish reconciliation').click(); await pg.get_by_text('Transactions cleared in this reconciliation').wait_for()
        await pg.goto(chk, wait_until='networkidle'); print('check status cleared:', await pg.get_by_text('cleared').count() > 0)
        # mileage, pages
        await pg.goto(B+'/mileage', wait_until='networkidle'); await pg.get_by_role('button', name='Log a trip').click(); await pg.fill('#f-purpose','Framing inspection'); await pg.fill('#f-odoStart','41200'); await pg.fill('#f-odoEnd','41238.4'); await save('Save'); await pg.screenshot(path=S+'mileage.png', full_page=True)
        for path,name in [('/', 'dash2'), (proj, 'project'), (proj+'/waivers','waivers'), (proj+'/closeout','closeout'), ('/reports/profit-loss','pl'), ('/reports/balance-sheet','bs'), ('/vendors','vendors'), ('/search?q=bright','search'), ('/ledger?view=journal','journal'), ('/settings?tab=audit','audit'), (proj+'/documents','docs'), (proj+'/budget','budget'), ('/expenses','expenses'), ('/reports','reports')]:
            resp = await pg.goto(path if path.startswith('http') else B+path, wait_until='networkidle'); print(path, resp.status); await pg.screenshot(path=S+name+'.png', full_page=True)
        for k in ['final-project','project-ledger']:
            r = await cx.request.get(proj.replace('/projects/','/api/reports/'+k+'?project=')+'&format=pdf'); open(S+k+'.pdf','wb').write(await r.body()); print(k, r.status)
        m = await cx.new_page(); await m.set_viewport_size({'width':390,'height':844}); await m.goto(B+'/mileage', wait_until='networkidle'); await m.screenshot(path=S+'mobile.png'); 
        print('ERRORS', errs[:10]); await b.close()
asyncio.run(main())
