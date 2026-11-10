// АВТОСАЛОН — лабораторна робота
// Серверна валідація всіх полів форм (у HTML немає жодного атрибута required).

const express = require('express');
const db = require('./db');
const entities = require('./entities');
const views = require('./views');
const { esc } = views;

const app = express();
app.use(express.urlencoded({ extended: true })); // розбір даних форм

// ---------- Валідація запису на сервері ----------
// Повертає { errors, values } — errors порожній, якщо все гаразд.
function validateEntity(entity, body, currentId = null) {
  const errors = {};
  const values = {};

  for (const f of entity.fields) {
    const raw = body[f.name];

    // чекбокси (додаткові опції) — масив або undefined
    if (f.type === 'checkboxes') {
      values[f.name] = Array.isArray(raw) ? raw.map(Number).filter(Number.isInteger) : [];
      continue;
    }

    const value = typeof raw === 'string' ? raw.trim() : (raw ?? '');
    values[f.name] = value;

    for (const rule of f.validators) {
      const err = rule(value, db, currentId);
      if (err) { errors[f.name] = err; break; } // перша помилка по полю
    }
  }
  return { errors, values };
}

// ---------- Допоміжне: як показувати колонки списку ----------
function cellValue(row, col, entity) {
  if (col === 'brand_id') {
    const b = db.get('brands', row.brand_id);
    return b ? `${b.name} (${b.country})` : '—';
  }
  if (col === 'client_id') {
    const c = db.get('clients', row.client_id);
    return c ? c.full_name : '—';
  }
  if (col === 'trim_id') {
    const t = db.get('trims', row.trim_id);
    if (!t) return '—';
    const b = db.get('brands', t.brand_id);
    return `${b ? b.name + ' ' : ''}${t.name}`;
  }
  if (col === 'options') {
    return db.getSaleOptions(row.id)
      .map(oid => { const o = db.get('options', oid); return o ? o.name : null; })
      .filter(Boolean).join(', ') || '—';
  }
  return row[col];
}

// Для select комплектацій — додамо назву марки у підпис
function decorateTrims() {
  for (const t of db.all('trims')) t.__brandName = (db.get('brands', t.brand_id) || {}).name || '';
}

// ---------- Головна ----------
app.get('/', (req, res) => {
  const cards = Object.values(entities).map(e => `
    <p><a href="/${e.key}">${esc(e.title)}</a> — записів: ${db.all(e.key).length}</p>`).join('');
  res.send(views.layout('Головна', `<h2>Таблиці бази даних</h2>${cards}`));
});

// ---------- Список / форма додавання ----------
for (const entity of Object.values(entities)) {
  app.get(`/${entity.key}`, (req, res) => {
    decorateTrims();
    const f = req.query.ok ? views.flash('ok', String(req.query.ok))
           : req.query.err ? views.flash('err', String(req.query.err)) : '';
    res.send(views.layout(entity.title,
      views.listPage(entity, db.all(entity.key), { cell: cellValue }), f));
  });

  app.get(`/${entity.key}/new`, (req, res) => {
    decorateTrims();
    res.send(views.layout(entity.title, views.formPage(entity, {
      title: `Додати — ${entity.single}`,
      action: `/${entity.key}`,
      submitLabel: 'Створити',
      values: {}
    })));
  });

  app.post(`/${entity.key}`, (req, res) => {
    decorateTrims();
    const { errors, values } = validateEntity(entity, req.body);

    if (Object.keys(errors).length > 0) {
      // ПОМИЛКИ: знову показуємо форму зі введеними значеннями та повідомленнями
      return res.status(400).send(views.layout(entity.title, views.formPage(entity, {
        title: `Додати — ${entity.single}`,
        action: `/${entity.key}`,
        submitLabel: 'Створити',
        values,
        errors
      }), views.flash('err', 'Форма заповнена з помилками — виправте поля, виділені червоним')));
    }

    const record = { ...values };
    if (entity.key === 'sales') {
      const optionIds = values.options;
      delete record.options;
      const created = db.insert('sales', record);
      db.setSaleOptions(created.id, optionIds);
    } else {
      // числові поля приводимо до числа
      for (const f of entity.fields) {
        if (f.name === 'brand_id' || f.name === 'client_id' || f.name === 'trim_id') record[f.name] = Number(record[f.name]);
      }
      db.insert(entity.key, record);
    }
    res.redirect(`/${entity.key}?ok=Створено`);
  });

  app.get(`/${entity.key}/:id/edit`, (req, res) => {
    decorateTrims();
    const row = db.get(entity.key, req.params.id);
    if (!row) return res.status(404).send(views.layout('404', views.flash('err', 'Запис не знайдено')));

    const values = { ...row };
    if (entity.key === 'sales') values.options = db.getSaleOptions(row.id);
    res.send(views.layout(entity.title, views.formPage(entity, {
      title: `Редагувати — ${entity.single} №${row.id}`,
      action: `/${entity.key}/${row.id}`,
      submitLabel: 'Зберегти зміни',
      values
    })));
  });

  app.post(`/${entity.key}/:id`, (req, res) => {
    decorateTrims();
    const row = db.get(entity.key, req.params.id);
    if (!row) return res.status(404).send(views.layout('404', views.flash('err', 'Запис не знайдено')));

    const { errors, values } = validateEntity(entity, req.body, row.id);
    if (Object.keys(errors).length > 0) {
      return res.status(400).send(views.layout(entity.title, views.formPage(entity, {
        title: `Редагувати — ${entity.single} №${row.id}`,
        action: `/${entity.key}/${row.id}`,
        submitLabel: 'Зберегти зміни',
        values,
        errors
      }), views.flash('err', 'Форма заповнена з помилками — виправте поля, виділені червоним')));
    }

    const record = { ...values };
    if (entity.key === 'sales') {
      const optionIds = values.options;
      delete record.options;
      db.update('sales', row.id, record);
      db.setSaleOptions(row.id, optionIds);
    } else {
      for (const f of entity.fields) {
        if (f.name === 'brand_id' || f.name === 'client_id' || f.name === 'trim_id') record[f.name] = Number(record[f.name]);
      }
      db.update(entity.key, row.id, record);
    }
    res.redirect(`/${entity.key}?ok=Збережено`);
  });

  app.post(`/${entity.key}/:id/delete`, (req, res) => {
    const row = db.get(entity.key, req.params.id);
    if (!row) return res.redirect(`/${entity.key}?err=Запис+не+знайдено`);

    // Серверна перевірка посилальної цілісності перед видаленням
    if (entity.deleteBlockedBy) {
      const { table, fk, message } = entity.deleteBlockedBy;
      if (db.findBy(table, fk, row.id).length > 0) {
        return res.redirect(`/${entity.key}?err=${encodeURIComponent(message)}`);
      }
    }

    if (entity.cascade === 'sale_options') db.removeSaleOptions(row.id);
    db.remove(entity.key, row.id);
    res.redirect(`/${entity.key}?ok=Видалено`);
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Автосалон: http://localhost:${PORT}`));
