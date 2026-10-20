import { useState } from 'react';
import { api, ApiError } from '../api';
import type { Contact, ContactType } from '../types';
import { Button, Field, Icon, Modal, useToast } from '../ui';

interface Props {
  contact?: Contact | null;
  onClose: () => void;
  onSaved: (contact: Contact) => void;
  onArchived?: () => void;
}

export function ContactModal({ contact, onClose, onSaved, onArchived }: Props) {
  const toast = useToast();
  const [type, setType] = useState<ContactType>(contact?.type ?? 'customer');
  const [name, setName] = useState(contact?.name ?? '');
  const [company, setCompany] = useState(contact?.company ?? '');
  const [email, setEmail] = useState(contact?.email ?? '');
  const [phone, setPhone] = useState(contact?.phone ?? '');
  const [address, setAddress] = useState(contact?.address ?? '');
  const [city, setCity] = useState(contact?.city ?? '');
  const [country, setCountry] = useState(contact?.country ?? 'United States');
  const [taxId, setTaxId] = useState(contact?.taxId ?? '');
  const [termsDays, setTermsDays] = useState(contact?.termsDays ?? 30);
  const [notes, setNotes] = useState(contact?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    if (!name.trim()) return setError('Name is required');
    setBusy(true);
    try {
      const payload = { type, name: name.trim(), company: company.trim(), email: email.trim(), phone: phone.trim(), address: address.trim(), city: city.trim(), country: country.trim(), taxId: taxId.trim(), termsDays: Number(termsDays) || 0, notes: notes.trim() };
      const saved = contact
        ? await api.put<Contact>(`/contacts/${contact.id}`, { ...payload, archived: contact.archived })
        : await api.post<Contact>('/contacts', payload);
      toast.push(contact ? 'Contact updated' : 'Contact created');
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    if (!contact) return;
    setBusy(true);
    try {
      await api.del(`/contacts/${contact.id}`);
      toast.push('Contact archived');
      onArchived?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={contact ? `Edit ${contact.name}` : 'New contact'}
      sub="Customers receive invoices; vendors send you bills"
      onClose={onClose}
      footer={(
        <>
          {contact ? <Button variant="danger" size="sm" onClick={archive} disabled={busy} style={{ marginRight: 'auto' }}><Icon name="trash" size={14} /> Archive</Button> : null}
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save contact'}</Button>
        </>
      )}
    >
      {error ? <div className="banner banner-neg" style={{ marginBottom: 12 }}><Icon name="alert" size={15} />{error}</div> : null}
      <div className="form-grid">
        <div className="col-4">
          <Field label="Type">
            <select className="select" value={type} onChange={(e) => setType(e.target.value as ContactType)}>
              <option value="customer">Customer</option>
              <option value="vendor">Vendor</option>
              <option value="both">Customer & vendor</option>
            </select>
          </Field>
        </div>
        <div className="col-8">
          <Field label="Name">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Harbor Dental Group" />
          </Field>
        </div>
        <div className="col-6">
          <Field label="Company">
            <input className="input" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Legal entity name" />
          </Field>
        </div>
        <div className="col-6">
          <Field label="Payment terms (days)">
            <input className="input num" type="number" min="0" max="365" value={termsDays} onChange={(e) => setTermsDays(Number(e.target.value))} />
          </Field>
        </div>
        <div className="col-6">
          <Field label="Email">
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="billing@company.com" />
          </Field>
        </div>
        <div className="col-6">
          <Field label="Phone">
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 010 2030" />
          </Field>
        </div>
        <div className="col-8">
          <Field label="Address">
            <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street address" />
          </Field>
        </div>
        <div className="col-4">
          <Field label="City">
            <input className="input" value={city} onChange={(e) => setCity(e.target.value)} />
          </Field>
        </div>
        <div className="col-6">
          <Field label="Country">
            <input className="input" value={country} onChange={(e) => setCountry(e.target.value)} />
          </Field>
        </div>
        <div className="col-6">
          <Field label="Tax ID">
            <input className="input" value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder="Optional" />
          </Field>
        </div>
        <div className="col-12">
          <Field label="Notes">
            <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Context, billing quirks, contact preferences…" />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
