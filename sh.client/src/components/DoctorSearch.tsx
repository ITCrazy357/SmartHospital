import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, MapPin, SlidersHorizontal, ChevronLeft, ChevronRight, ChevronDown, X } from 'lucide-react';
import { getDepartmentListFromApi } from '../constants';
import { DoctorCard } from './DoctorCard';
import { DoctorCardSkeleton } from './DoctorCardSkeleton';
import { Doctor } from '../types';
import { api } from '../api/client';
import { mapDoctor } from '../api/mappers';
import { getPage, getDepartmentId, getSearchQuery, replaceSearchParams } from '../utils/urlSearchParams';
import { isUuid } from '../utils/isUuid';
import { searchDoctors } from '../api/doctor-search';
import { expandDoctorSearchAbbreviations } from '../utils/doctorSearchQuery';


const PAGE_SIZE = 5;

interface DoctorSearchProps {
  onBook: (doctor: Doctor) => void;
  onViewProfile: (doctor: Doctor) => void;
}

export const DoctorSearch: React.FC<DoctorSearchProps> = ({ onBook, onViewProfile }) => {
  const [searchQuery, setSearchQuery] = useState(() => getSearchQuery());
  const [departmentData,setDepartmentData]=useState<{id:string;name:string}[]>([]);
  const [departmentCounts,setDepartmentCounts]=useState<Record<string,number>>({});
  const departments=useMemo(()=>getDepartmentListFromApi(departmentData,{doctorCountByDeptId:departmentCounts}),[departmentData,departmentCounts]);
  const [totalItems,setTotalItems]=useState(0);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string | null>(() => {
    const id = getDepartmentId();
    return id && isUuid(id) ? id : null;
  });
  const [page, setPage] = useState(() => getPage());
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filterAvailToday, setFilterAvailToday] = useState(false);
  const [filterAvailTomorrow, setFilterAvailTomorrow] = useState(false);
  const [filterAvailWeek, setFilterAvailWeek] = useState(false);
  const [filterExp1_5, setFilterExp1_5] = useState(false);
  const [filterExp5_10, setFilterExp5_10] = useState(false);
  const [filterExp10, setFilterExp10] = useState(false);

  const availabilityLoading=loading;

  const [deptQuery, setDeptQuery] = useState('');
  const [deptOpen, setDeptOpen] = useState(false);
  const deptRef = useRef<HTMLDivElement>(null);
  const [deptsLoading, setDeptsLoading] = useState(true);

  const needAvailLookup = filterAvailToday || filterAvailTomorrow || filterAvailWeek;

  // Đóng dropdown khi click ra ngoài
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (deptRef.current && !deptRef.current.contains(e.target as Node)) {
        setDeptOpen(false);
        setDeptQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filteredDeptOptions = useMemo(() => {
    const q = deptQuery.trim().toLowerCase();
    if (!q) return departments;
    return departments.filter((d) => d.name.toLowerCase().includes(q));
  }, [departments, deptQuery]);

  useEffect(() => {
    setPage(getPage());
    const id = getDepartmentId();
    setSelectedDepartmentId(id && isUuid(id) ? id : null);
    setSearchQuery(getSearchQuery());
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setPage(getPage());
      const id = getDepartmentId();
      setSelectedDepartmentId(id && isUuid(id) ? id : null);
      setSearchQuery(getSearchQuery());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    let cancelled=false;
    api.getDepartments().then(list=>{if(!cancelled)setDepartmentData(list);})
      .catch(()=>{if(!cancelled)setDepartmentData([]);})
      .finally(()=>{if(!cancelled)setDeptsLoading(false);});
    return()=>{cancelled=true;};
  },[]);

  const filterKey=JSON.stringify([searchQuery,selectedDepartmentId,filterExp1_5,filterExp5_10,filterExp10,filterAvailToday,filterAvailTomorrow,filterAvailWeek]);


  useEffect(()=>{
    let cancelled=false;
    setLoading(true);setError(null);
    const timer=setTimeout(()=>{
      searchDoctors({page,pageSize:PAGE_SIZE,q:expandDoctorSearchAbbreviations(searchQuery),departmentId:selectedDepartmentId??undefined,
        experience:[filterExp1_5?'1-5':'',filterExp5_10?'5-10':'',filterExp10?'10+':''].filter(Boolean),
        availability:[filterAvailToday?'today':'',filterAvailTomorrow?'tomorrow':'',filterAvailWeek?'week':''].filter(Boolean)})
      .then(result=>{
        if(cancelled)return;
        const lastPage=Math.max(1,Math.ceil(result.total/PAGE_SIZE));
        setTotalItems(result.total);setDepartmentCounts(result.departmentCounts);
        if(page>lastPage){setPage(lastPage);replaceSearchParams({page:lastPage});return;}
        setDoctors(result.items.map(mapDoctor));
      }).catch(e=>{if(!cancelled){setError(e instanceof Error?e.message:'Không tải được danh sách bác sĩ');setDoctors([]);setTotalItems(0);}})
      .finally(()=>{if(!cancelled)setLoading(false);});
    },200);
    return()=>{cancelled=true;clearTimeout(timer);};
  },[page,filterKey]);

  const filteredDoctors=doctors;
  const totalPages=Math.max(1,Math.ceil(totalItems/PAGE_SIZE));
  const safePage=Math.min(Math.max(1,page),totalPages);
  const paginatedDoctors=doctors;
  const selectedDeptName = selectedDepartmentId
    ? departments.find((d) => d.id === selectedDepartmentId)?.name ?? null
    : null;

  const updateUrl = (p: number, deptId: string | null) => {
    replaceSearchParams({
      view: 'search',
      page: p > 1 ? p : 1,
      departmentId: deptId,
    });
  };

  const goToPage = (p: number) => {
    const next = Math.max(1, Math.min(p, totalPages));
    setPage(next);
    updateUrl(next, selectedDepartmentId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const resetFilters = () => {
    setSelectedDepartmentId(null);
    setSearchQuery('');
    setPage(1);
    setFilterAvailToday(false);
    setFilterAvailTomorrow(false);
    setFilterAvailWeek(false);
    setFilterExp1_5(false);
    setFilterExp5_10(false);
    setFilterExp10(false);


    replaceSearchParams({
      view: 'search',
      page: 1,
      departmentId: null,
      q: null,
    });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="flex flex-col lg:flex-row gap-8">
        <aside className="w-full lg:w-72 space-y-8">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-slate-900 flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-primary" />
                Bộ lọc
              </h2>
              <button
                type="button"
                onClick={resetFilters}
                className="text-xs font-bold text-primary hover:underline"
              >
                Đặt lại
              </button>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-bold text-slate-900">Khoa</h3>
              <div ref={deptRef} className="relative">
                {deptsLoading ? (
                  <div className="relative h-9 w-full rounded-xl bg-slate-200 overflow-hidden">
                    <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.4s_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent" />
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => { setDeptOpen((o) => !o); setDeptQuery(''); }}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm hover:border-primary/40 transition-colors"
                    >
                      <span className={selectedDepartmentId ? 'text-slate-900 font-medium truncate' : 'text-slate-400'}>
                        {selectedDepartmentId
                          ? departments.find((d) => d.id === selectedDepartmentId)?.name ?? 'Chọn khoa'
                          : 'Tất cả khoa'}
                      </span>
                      <span className="flex items-center gap-1 shrink-0">
                        {selectedDepartmentId && (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedDepartmentId(null);
                              setPage(1);
                              updateUrl(1, null);
                            }}
                            onKeyDown={(e) => e.key === 'Enter' && (() => { setSelectedDepartmentId(null); setPage(1); updateUrl(1, null); })()}
                            className="text-slate-400 hover:text-slate-700"
                          >
                            <X className="w-3.5 h-3.5" />
                          </span>
                        )}
                        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${deptOpen ? 'rotate-180' : ''}`} />
                      </span>
                    </button>

                    {deptOpen && (
                      <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                        <div className="p-2 border-b border-slate-100">
                          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-slate-50">
                            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <input
                              autoFocus
                              type="text"
                              placeholder="Tìm khoa..."
                              value={deptQuery}
                              onChange={(e) => setDeptQuery(e.target.value)}
                              className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
                            />
                          </div>
                        </div>
                        <ul className="max-h-52 overflow-y-auto py-1">
                          <li>
                            <button
                              type="button"
                              onClick={() => { setSelectedDepartmentId(null); setPage(1); updateUrl(1, null); setDeptOpen(false); setDeptQuery(''); }}
                              className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-slate-50 ${!selectedDepartmentId ? 'font-bold text-primary' : 'text-slate-600'}`}
                            >
                              Tất cả khoa
                            </button>
                          </li>
                          {filteredDeptOptions.length === 0 ? (
                            <li className="px-3 py-2 text-sm text-slate-400">Không tìm thấy</li>
                          ) : (
                            filteredDeptOptions.map((dept) => (
                              <li key={dept.id}>
                                <button
                                  type="button"
                                  onClick={() => { setSelectedDepartmentId(dept.id); setPage(1); updateUrl(1, dept.id); setDeptOpen(false); setDeptQuery(''); }}
                                  className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-slate-50 ${selectedDepartmentId === dept.id ? 'font-bold text-primary bg-primary/5' : 'text-slate-600'}`}
                                >
                                  {dept.name}
                                </button>
                              </li>
                            ))
                          )}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-bold text-slate-900">Lịch trống</h3>
              <p className="text-xs text-slate-500">
                Lịch còn trống được kiểm tra theo giờ Việt Nam.
              </p>
              {availabilityLoading && needAvailLookup && (
                <p className="text-xs font-medium text-primary">Đang kiểm tra lịch…</p>
              )}
              <div className="space-y-2">
                <label className="flex items-center gap-3 group cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary"
                    checked={filterAvailToday}
                    onChange={(e) => { setFilterAvailToday(e.target.checked); setPage(1); replaceSearchParams({page:1}); }}
                  />
                  <span className="text-sm text-slate-600 group-hover:text-slate-900 transition-colors">
                    Bác sĩ còn lịch hôm nay
                  </span>
                </label>
                <label className="flex items-center gap-3 group cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary"
                    checked={filterAvailTomorrow}
                    onChange={(e) => { setFilterAvailTomorrow(e.target.checked); setPage(1); replaceSearchParams({page:1}); }}
                  />
                  <span className="text-sm text-slate-600 group-hover:text-slate-900 transition-colors">
                    Còn lịch ngày mai
                  </span>
                </label>
                <label className="flex items-center gap-3 group cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary"
                    checked={filterAvailWeek}
                    onChange={(e) => { setFilterAvailWeek(e.target.checked); setPage(1); replaceSearchParams({page:1}); }}
                  />
                  <span className="text-sm text-slate-600 group-hover:text-slate-900 transition-colors">
                    Còn lịch tuần này
                  </span>
                </label>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-bold text-slate-900">Số năm kinh nghiệm</h3>
              <div className="space-y-2">
                <label className="flex items-center gap-3 group cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary"
                    checked={filterExp1_5}
                    onChange={(e) => { setFilterExp1_5(e.target.checked); setPage(1); replaceSearchParams({page:1}); }}
                  />
                  <span className="text-sm text-slate-600 group-hover:text-slate-900 transition-colors">
                    1–5 năm
                  </span>
                </label>
                <label className="flex items-center gap-3 group cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary"
                    checked={filterExp5_10}
                    onChange={(e) => { setFilterExp5_10(e.target.checked); setPage(1); replaceSearchParams({page:1}); }}
                  />
                  <span className="text-sm text-slate-600 group-hover:text-slate-900 transition-colors">
                    5–10 năm
                  </span>
                </label>
                <label className="flex items-center gap-3 group cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary"
                    checked={filterExp10}
                    onChange={(e) => { setFilterExp10(e.target.checked); setPage(1); replaceSearchParams({page:1}); }}
                  />
                  <span className="text-sm text-slate-600 group-hover:text-slate-900 transition-colors">
                    Trên 10 năm
                  </span>
                </label>
              </div>
            </div>
          </div>

        </aside>

        <main className="flex-1 space-y-8">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="flex items-center rounded-xl border border-slate-200/90 bg-slate-50 px-4 py-2 gap-3 transition-colors focus-within:border-primary/25 focus-within:bg-white w-full md:w-96">
              <Search className="w-5 h-5 shrink-0 text-slate-400" />
              <input
                type="text"
                placeholder="Tìm theo tên hoặc khoa…"
                autoComplete="off"
                className="min-w-0 w-full appearance-none border-0 bg-transparent text-sm shadow-none outline-none ring-0 placeholder:text-slate-400 focus:border-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
                value={searchQuery}
                onChange={(e) => {
                  const v = e.target.value;
                  setSearchQuery(v);
                  setPage(1);
                  const t = v.trim();
                  replaceSearchParams({ q: t ? t : null, page:1 });
                }}
              />
            </div>
          </div>

          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-slate-500 font-medium">
              Hiển thị <span className="text-slate-900 font-bold">{totalItems}</span> bác sĩ
              {selectedDeptName && (
                <> tại khoa <span className="text-slate-900 font-bold">{selectedDeptName}</span></>
              )}
              {totalPages > 1 && (
                <> · Trang <span className="text-slate-900 font-bold">{safePage}</span>/<span className="text-slate-900 font-bold">{totalPages}</span></>
              )}
            </p>
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <MapPin className="w-4 h-4 text-primary" />
              Bệnh viện
            </div>
          </div>

          {error && <p className="text-red-600 font-medium">{error}</p>}
          {loading ? (
            <div className="space-y-6">
              {Array.from({ length: PAGE_SIZE }).map((_, i) => (
                <DoctorCardSkeleton key={i} />
              ))}
            </div>
          ) : (
            <>
              <div className="space-y-6">
                {paginatedDoctors.map((doctor) => (
                  <DoctorCard
                    key={doctor.id}
                    doctor={doctor}
                    onBook={onBook}
                    onViewProfile={onViewProfile}
                  />
                ))}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 pt-8 flex-wrap">
                  <button
                    type="button"
                    onClick={() => goToPage(safePage - 1)}
                    disabled={safePage <= 1}
                    className="flex items-center gap-1 px-4 py-2 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Trước
                  </button>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: Math.min(7,totalPages) }, (_, i) => Math.max(1,Math.min(safePage-3,totalPages-6))+i).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => goToPage(p)}
                        className={`min-w-[2.5rem] h-10 rounded-xl font-bold text-sm transition-all ${
                          p === safePage
                            ? 'bg-primary text-white shadow-lg shadow-primary/20'
                            : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => goToPage(safePage + 1)}
                    disabled={safePage >= totalPages}
                    className="flex items-center gap-1 px-4 py-2 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Sau
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </>
          )}

          {!loading && !error && filteredDoctors.length === 0 && (
            <p className="text-slate-500 text-center py-8">Không tìm thấy bác sĩ phù hợp.</p>
          )}
        </main>
      </div>
    </div>
  );
};
