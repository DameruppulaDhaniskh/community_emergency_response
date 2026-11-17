import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getSocieties,
  createSociety,
  updateSociety,
  deleteSociety,
  getBlocks,
  createBlock,
  updateBlock,
  deleteBlock,
  getFlats,
  createFlat,
  updateFlat,
  deleteFlat,
} from '../../api/society';
import Button from '../../components/Button';
import Input from '../../components/Input';
import Modal from '../../components/Modal';
import EmptyState from '../../components/EmptyState';
import PageContainer from '../../components/PageContainer';
import Card, { CardHeader } from '../../components/Card';
import { SkeletonCard } from '../../components/Skeleton';
import { useToast } from '../../components/Toast';
import {
  Building2,
  Layers,
  DoorOpen,
  Plus,
  ChevronRight,
  ArrowLeft,
  Edit2,
  Trash2,
  Search,
  MapPin,
  Home,
} from 'lucide-react';
import type { Society, Block, Flat } from '../../api/types';

type View = 'societies' | 'blocks' | 'flats';

export default function SocietyManagementPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Drill-down state
  const [view, setView] = useState<View>('societies');
  const [selectedSociety, setSelectedSociety] = useState<Society | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<Block | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState<'society' | 'block' | 'flat'>('society');
  const [editingItem, setEditingItem] = useState<Society | Block | Flat | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});

  const [search, setSearch] = useState('');

  // ── Queries ──
  const { data: societies, isLoading: societiesLoading } = useQuery({
    queryKey: ['societies'],
    queryFn: () => getSocieties(),
  });

  const { data: blocks, isLoading: blocksLoading } = useQuery({
    queryKey: ['blocks', selectedSociety?.id],
    queryFn: () => getBlocks(selectedSociety!.id),
    enabled: !!selectedSociety,
  });

  const { data: flats, isLoading: flatsLoading } = useQuery({
    queryKey: ['flats', selectedBlock?.id],
    queryFn: () => getFlats(selectedBlock!.id),
    enabled: !!selectedBlock,
  });

  // ── Mutations ──
  const createSocietyMut = useMutation({
    mutationFn: createSociety,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['societies'] });
      toast('success', 'Society registered successfully.');
      closeModal();
    },
    onError: () => toast('error', 'Could not create society.'),
  });

  const updateSocietyMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Society> }) => updateSociety(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['societies'] });
      toast('success', 'Society updated.');
      closeModal();
    },
    onError: () => toast('error', 'Could not update society.'),
  });

  const deleteSocietyMut = useMutation({
    mutationFn: deleteSociety,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['societies'] });
      toast('success', 'Society deleted.');
    },
    onError: () => toast('error', 'Could not delete society.'),
  });

  const createBlockMut = useMutation({
    mutationFn: ({ societyId, data }: { societyId: number; data: Partial<Block> }) =>
      createBlock(societyId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blocks'] });
      toast('success', 'Block added successfully.');
      closeModal();
    },
    onError: () => toast('error', 'Could not create block.'),
  });

  const updateBlockMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Block> }) => updateBlock(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blocks'] });
      toast('success', 'Block updated.');
      closeModal();
    },
    onError: () => toast('error', 'Could not update block.'),
  });

  const deleteBlockMut = useMutation({
    mutationFn: deleteBlock,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blocks'] });
      toast('success', 'Block deleted.');
    },
    onError: () => toast('error', 'Could not delete block.'),
  });

  const createFlatMut = useMutation({
    mutationFn: ({ blockId, data }: { blockId: number; data: Partial<Flat> }) =>
      createFlat(blockId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flats'] });
      toast('success', 'Flat unit created.');
      closeModal();
    },
    onError: () => toast('error', 'Could not create flat.'),
  });

  const updateFlatMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Flat> }) => updateFlat(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flats'] });
      toast('success', 'Flat updated.');
      closeModal();
    },
    onError: () => toast('error', 'Could not update flat.'),
  });

  const deleteFlatMut = useMutation({
    mutationFn: deleteFlat,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flats'] });
      toast('success', 'Flat deleted.');
    },
    onError: () => toast('error', 'Could not delete flat.'),
  });

  // ── Modal helpers ──
  const openCreate = (type: 'society' | 'block' | 'flat') => {
    setModalType(type);
    setEditingItem(null);
    setFormData({});
    setModalOpen(true);
  };

  const openEdit = (type: 'society' | 'block' | 'flat', item: Society | Block | Flat) => {
    setModalType(type);
    setEditingItem(item);
    setFormData({
      name: (item as Society).name || (item as Block).name || '',
      flat_number: (item as Flat).flat_number || '',
      floor: String((item as Flat).floor || ''),
      address: (item as Society).address || '',
      city: (item as Society).city || '',
      state: (item as Society).state || '',
      pincode: (item as Society).pincode || '',
      total_floors: String((item as Block).total_floors || ''),
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingItem(null);
    setFormData({});
  };

  const handleSave = () => {
    if (modalType === 'society') {
      const payload = {
        name: formData.name,
        address: formData.address,
        city: formData.city,
        state: formData.state,
        pincode: formData.pincode,
      };
      if (editingItem) updateSocietyMut.mutate({ id: editingItem.id, data: payload });
      else createSocietyMut.mutate(payload);
    } else if (modalType === 'block' && selectedSociety) {
      const payload = { name: formData.name, total_floors: Number(formData.total_floors) || 0 };
      if (editingItem) updateBlockMut.mutate({ id: editingItem.id, data: payload });
      else createBlockMut.mutate({ societyId: selectedSociety.id, data: payload });
    } else if (modalType === 'flat' && selectedBlock) {
      const payload = { flat_number: formData.flat_number, floor: Number(formData.floor) || 0 };
      if (editingItem) updateFlatMut.mutate({ id: editingItem.id, data: payload });
      else createFlatMut.mutate({ blockId: selectedBlock.id, data: payload });
    }
  };

  const filteredSocieties = (societies || []).filter(
    (s) => !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.city?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <PageContainer>
      {/* Header with drill-down breadcrumb */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border/60">
        <div>
          <nav className="flex items-center gap-1.5 text-xs text-ink-tertiary mb-1 font-medium">
            <button
              onClick={() => {
                setView('societies');
                setSelectedSociety(null);
                setSelectedBlock(null);
              }}
              className={`hover:text-primary transition-colors flex items-center gap-1 ${
                view === 'societies' ? 'text-primary font-semibold' : ''
              }`}
            >
              <Home className="w-3.5 h-3.5" />
              Societies
            </button>

            {selectedSociety && (
              <>
                <ChevronRight className="w-3.5 h-3.5 text-ink-disabled" />
                <button
                  onClick={() => {
                    setView('blocks');
                    setSelectedBlock(null);
                  }}
                  className={`hover:text-primary transition-colors ${
                    view === 'blocks' ? 'text-primary font-semibold' : ''
                  }`}
                >
                  {selectedSociety.name}
                </button>
              </>
            )}

            {selectedBlock && (
              <>
                <ChevronRight className="w-3.5 h-3.5 text-ink-disabled" />
                <span className="text-ink font-semibold">{selectedBlock.name}</span>
              </>
            )}
          </nav>

          <h1 className="font-serif text-2xl lg:text-3xl text-ink font-semibold tracking-tight">
            {view === 'societies' && 'Society Infrastructure'}
            {view === 'blocks' && `${selectedSociety?.name} — Blocks & Towers`}
            {view === 'flats' && `${selectedBlock?.name} — Flats & Units`}
          </h1>
          <p className="text-xs text-ink-secondary mt-0.5">
            {view === 'societies' && 'Manage apartment complexes, gated layouts, and building hierarchies'}
            {view === 'blocks' && `Towers & blocks registered under ${selectedSociety?.name}`}
            {view === 'flats' && `Individual residential flats configured in ${selectedBlock?.name}`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {view !== 'societies' && (
            <Button
              variant="secondary"
              size="sm"
              icon={<ArrowLeft className="w-4 h-4" />}
              onClick={() => {
                if (view === 'flats') {
                  setView('blocks');
                  setSelectedBlock(null);
                } else {
                  setView('societies');
                  setSelectedSociety(null);
                }
              }}
            >
              Back
            </Button>
          )}
          <Button
            size="sm"
            icon={<Plus className="w-4 h-4" />}
            onClick={() => openCreate(view === 'flats' ? 'flat' : view === 'blocks' ? 'block' : 'society')}
          >
            Add {view === 'flats' ? 'Flat' : view === 'blocks' ? 'Block' : 'Society'}
          </Button>
        </div>
      </div>

      {/* Main View Cards */}
      {view === 'societies' && (
        <Card>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <CardHeader
              title={`Registered Societies (${societies?.length || 0})`}
              description="Click on any society to manage its blocks and flats"
            />
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search societies or cities..."
                className="w-full h-9 pl-9 pr-3 rounded-lg border border-border bg-surface-raised text-sm placeholder:text-ink-disabled focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {societiesLoading ? (
            <SkeletonCard count={3} />
          ) : filteredSocieties.length === 0 ? (
            <EmptyState
              icon={<Building2 className="w-8 h-8 text-primary" />}
              title="No societies registered"
              description="Add your first gated community or residential complex to begin setting up towers and flats."
              action={
                <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => openCreate('society')}>
                  Add Society
                </Button>
              }
            />
          ) : (
            <div className="divide-y divide-border border border-border rounded-xl overflow-hidden bg-surface-raised">
              {filteredSocieties.map((society) => (
                <div
                  key={society.id}
                  onClick={() => {
                    setSelectedSociety(society);
                    setView('blocks');
                  }}
                  className="p-4 flex items-center justify-between gap-4 hover:bg-surface-sunken/60 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-11 h-11 rounded-xl bg-primary-light text-primary flex items-center justify-center shrink-0">
                      <Building2 className="w-6 h-6" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink hover:text-primary transition-colors">
                        {society.name}
                      </p>
                      <p className="text-xs text-ink-secondary flex items-center gap-1 mt-0.5">
                        <MapPin className="w-3 h-3 text-ink-tertiary shrink-0" />
                        <span className="truncate">
                          {[society.address, society.city, society.state, society.pincode]
                            .filter(Boolean)
                            .join(', ') || 'No address specified'}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openEdit('society', society);
                      }}
                      className="p-2 rounded-lg hover:bg-surface-sunken text-ink-tertiary hover:text-ink transition-colors cursor-pointer"
                      title="Edit Society"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete ${society.name}? This will remove all associated blocks and flats.`)) {
                          deleteSocietyMut.mutate(society.id);
                        }
                      }}
                      className="p-2 rounded-lg hover:bg-critical-light/40 text-ink-tertiary hover:text-critical transition-colors cursor-pointer"
                      title="Delete Society"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <div className="pl-1 text-ink-tertiary">
                      <ChevronRight className="w-5 h-5" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ── Blocks list ── */}
      {view === 'blocks' && (
        <Card>
          <CardHeader
            title={`Blocks / Towers in ${selectedSociety?.name} (${blocks?.length || 0})`}
            description="Select a block to configure its residential flat units"
            action={
              <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => openCreate('block')}>
                Add Block
              </Button>
            }
          />

          {blocksLoading ? (
            <SkeletonCard count={3} />
          ) : !blocks || blocks.length === 0 ? (
            <EmptyState
              icon={<Layers className="w-8 h-8 text-primary" />}
              title="No blocks configured"
              description={`Add towers or wings (e.g. Tower A, Block B) to ${selectedSociety?.name}.`}
              action={
                <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => openCreate('block')}>
                  Add Block
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {blocks.map((block) => (
                <div
                  key={block.id}
                  onClick={() => {
                    setSelectedBlock(block);
                    setView('flats');
                  }}
                  className="p-4 rounded-xl border border-border bg-surface-raised hover:border-primary/50 hover:bg-surface-sunken/40 transition-all cursor-pointer flex flex-col justify-between"
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-surface-sunken flex items-center justify-center text-ink-secondary">
                        <Layers className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-ink">{block.name}</p>
                        <p className="text-xs text-ink-secondary mt-0.5">{block.total_floors} Floors</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openEdit('block', block);
                        }}
                        className="p-1.5 rounded-md hover:bg-surface-sunken text-ink-tertiary hover:text-ink cursor-pointer"
                        title="Edit Block"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete ${block.name}?`)) deleteBlockMut.mutate(block.id);
                        }}
                        className="p-1.5 rounded-md hover:bg-critical-light/40 text-ink-tertiary hover:text-critical cursor-pointer"
                        title="Delete Block"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-border/50 flex items-center justify-between text-xs text-primary font-medium">
                    <span>Manage Flats</span>
                    <ChevronRight className="w-4 h-4" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ── Flats list ── */}
      {view === 'flats' && (
        <Card>
          <CardHeader
            title={`Flats in ${selectedBlock?.name} (${flats?.length || 0})`}
            description={`Residential apartment units assigned to ${selectedBlock?.name}`}
            action={
              <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => openCreate('flat')}>
                Add Flat Unit
              </Button>
            }
          />

          {flatsLoading ? (
            <SkeletonCard count={4} />
          ) : !flats || flats.length === 0 ? (
            <EmptyState
              icon={<DoorOpen className="w-8 h-8 text-primary" />}
              title="No flats in this block"
              description={`Add flat numbers (e.g. 101, 102, 201) to ${selectedBlock?.name}.`}
              action={
                <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => openCreate('flat')}>
                  Add Flat Unit
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {flats.map((flat) => (
                <div
                  key={flat.id}
                  className="p-3 rounded-xl border border-border bg-surface-raised flex flex-col justify-between hover:border-primary/40 transition-colors"
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="text-xs font-bold text-ink">Flat {flat.flat_number}</span>
                    <div className="flex items-center">
                      <button
                        onClick={() => openEdit('flat', flat)}
                        className="p-1 hover:text-primary text-ink-tertiary cursor-pointer"
                        title="Edit"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Delete Flat ${flat.flat_number}?`)) deleteFlatMut.mutate(flat.id);
                        }}
                        className="p-1 hover:text-critical text-ink-tertiary cursor-pointer"
                        title="Delete"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  <span className="text-[11px] text-ink-tertiary">Floor {flat.floor}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ── Create/Edit modal ── */}
      <Modal open={modalOpen} onClose={closeModal} title={`${editingItem ? 'Edit' : 'Add'} ${modalType}`}>
        <div className="space-y-4">
          {modalType === 'society' && (
            <>
              <Input
                label="Society name"
                placeholder="Prestige Lakeside Habitat"
                value={formData.name || ''}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
              <Input
                label="Address"
                placeholder="Whitefield Main Road"
                value={formData.address || ''}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              />
              <div className="grid grid-cols-3 gap-2">
                <Input
                  label="City"
                  placeholder="Bengaluru"
                  value={formData.city || ''}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                />
                <Input
                  label="State"
                  placeholder="Karnataka"
                  value={formData.state || ''}
                  onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                />
                <Input
                  label="Pincode"
                  placeholder="560066"
                  value={formData.pincode || ''}
                  onChange={(e) => setFormData({ ...formData, pincode: e.target.value })}
                />
              </div>
            </>
          )}
          {modalType === 'block' && (
            <>
              <Input
                label="Block / tower name"
                placeholder="Tower B"
                value={formData.name || ''}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
              <Input
                label="Total floors"
                type="number"
                placeholder="12"
                value={formData.total_floors || ''}
                onChange={(e) => setFormData({ ...formData, total_floors: e.target.value })}
              />
            </>
          )}
          {modalType === 'flat' && (
            <>
              <Input
                label="Flat number"
                placeholder="904"
                value={formData.flat_number || ''}
                onChange={(e) => setFormData({ ...formData, flat_number: e.target.value })}
              />
              <Input
                label="Floor"
                type="number"
                placeholder="9"
                value={formData.floor || ''}
                onChange={(e) => setFormData({ ...formData, floor: e.target.value })}
              />
            </>
          )}
          <div className="flex gap-2 pt-2">
            <Button variant="secondary" className="flex-1" onClick={closeModal}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={handleSave}
              loading={
                createSocietyMut.isPending ||
                updateSocietyMut.isPending ||
                createBlockMut.isPending ||
                updateBlockMut.isPending ||
                createFlatMut.isPending ||
                updateFlatMut.isPending
              }
            >
              {editingItem ? 'Save Changes' : 'Create'}
            </Button>
          </div>
        </div>
      </Modal>
    </PageContainer>
  );
}
