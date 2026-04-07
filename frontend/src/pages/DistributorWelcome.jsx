import React, { useState, useEffect } from 'react';
import { ShoppingBag, PackageCheck, Heart, Sparkles, ChevronLeft, ChevronRight, Rocket, TrendingUp, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const slides = [
    {
        id: 1,
        image: '/images/hero/ultra1_lineup.png',
        title: 'Calidad Extraordinaria',
        subtitle: 'El mejor sabor y explosión garantizados para deleitar a tus clientes.',
        variant: 'default'
    },
    {
        id: 2,
        image: '/images/hero/ultra2.png',
        title: 'Frescura Impecable',
        subtitle: 'Ingredientes seleccionados, el estándar de oro en cada preparación.',
        variant: 'default'
    },
    {
        id: 3,
        image: '/images/hero/ultra3.png',
        title: 'Maracuyá con Sal',
        subtitle: 'La fusión más atrevida del año. Una explosión tropical inigualable.',
        badge: 'LANZAMIENTO 15 ABRIL',
        variant: 'launch'
    }
];

const DistributorWelcome = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [currentSlide, setCurrentSlide] = useState(0);

    // Auto-advance
    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentSlide((prev) => (prev + 1) % slides.length);
        }, 6000);
        return () => clearInterval(timer);
    }, []);

    const nextSlide = () => setCurrentSlide((prev) => (prev + 1) % slides.length);
    const prevSlide = () => setCurrentSlide((prev) => (prev - 1 + slides.length) % slides.length);
    
    return (
        <div className="w-full animate-fade-in font-sans tracking-tight bg-[#fcf9f8] min-h-screen">
            
            {/* IMMERSIVE FULL-COVER HERO SLIDER */}
            <div className="relative w-full h-[65vh] md:h-[75vh] min-h-[550px] mb-16 overflow-hidden shadow-2xl group bg-[#0a0a0a]">
                {slides.map((slide, index) => {
                    const isActive = index === currentSlide;
                    return (
                        <div 
                            key={slide.id}
                            className={`absolute inset-0 transition-opacity duration-1000 ease-in-out ${isActive ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}
                        >
                            {/* Desktop: Split Screen. Mobile: Stacked / Full Cover with Gradient */}
                            <div className="w-full h-full flex flex-col md:flex-row">
                                
                                {/* LEFT HALF: Typography and Call to Action */}
                                <div className={`w-full md:w-1/2 h-[55%] md:h-full flex flex-col items-center md:items-start justify-center p-8 md:p-16 lg:p-24 bg-[#0a0a0a] relative z-20 text-center md:text-left transition-opacity duration-1000 delay-100 ${isActive ? 'opacity-100' : 'opacity-0'}`}>
                                    
                                    {slide.variant === 'launch' && slide.badge && (
                                        <div className="font-outfit inline-flex items-center gap-2 px-5 py-2 rounded-full bg-white/10 text-[#8ef4e9] text-xs font-bold tracking-[0.2em] uppercase mb-6 border border-white/20">
                                            <Rocket size={18} /> {slide.badge}
                                        </div>
                                    )}
                                    
                                    <h2 className={`font-playfair font-bold italic tracking-tight mb-4 leading-[1.1] ${slide.variant === 'launch' ? 'text-4xl md:text-6xl lg:text-7xl text-transparent bg-clip-text bg-gradient-to-r from-white via-[#e2fffa] to-[#8ef4e9]' : 'text-4xl md:text-6xl lg:text-7xl text-white'}`}>
                                        {slide.title}
                                    </h2>
                                    
                                    <p className="font-outfit text-lg md:text-xl lg:text-2xl text-white/70 font-light leading-relaxed max-w-xl">
                                        {slide.subtitle}
                                    </p>

                                    {slide.variant === 'launch' && (
                                        <button className="font-outfit mt-8 px-8 py-4 bg-gradient-to-r from-[#614eb7] to-[#a391ff] hover:from-[#5441aa] hover:to-[#9684f1] text-white font-bold rounded-full shadow-[0_10px_30px_rgba(97,78,183,0.3)] transition-all transform hover:-translate-y-1 text-sm tracking-[0.1em] uppercase border border-white/20">
                                            Explorar Nueva Colección
                                        </button>
                                    )}
                                </div>
                                
                                {/* RIGHT HALF: The Ultra-Crisp AI Image */}
                                <div className="w-full md:w-1/2 h-[45%] md:h-full relative overflow-hidden bg-black flex-1 order-first md:order-last">
                                    <img 
                                        src={slide.image} 
                                        alt={slide.title} 
                                        className={`absolute inset-0 w-full h-full object-cover md:object-center transition-transform duration-[15000ms] ease-linear ${isActive ? 'scale-110' : 'scale-100'}`} 
                                    />
                                    {/* Subtle inner shadow/gradient edge to blend with left side seamlessly on desktop */}
                                    <div className={`absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-[#0a0a0a] to-transparent hidden md:block transition-opacity duration-1000 ${isActive ? 'opacity-100' : 'opacity-0'}`}></div>
                                    {/* Mobile Gradient Overlay */}
                                    <div className={`absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/60 to-transparent md:hidden transition-opacity duration-1000 ${isActive ? 'opacity-100' : 'opacity-0'}`}></div>
                                </div>
                            </div>
                        </div>
                    );
                })}

                {/* Slider Controls */}
                <button 
                    onClick={prevSlide}
                    className="absolute left-6 top-1/2 -translate-y-1/2 z-30 w-12 h-12 rounded-full bg-white/5 hover:bg-white/20 text-[#fcf9f8] flex items-center justify-center backdrop-blur-xl border border-white/10 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100 shadow-xl"
                >
                    <ChevronLeft size={24} />
                </button>
                <button 
                    onClick={nextSlide}
                    className="absolute right-6 top-1/2 -translate-y-1/2 z-30 w-12 h-12 rounded-full bg-white/5 hover:bg-white/20 text-[#fcf9f8] flex items-center justify-center backdrop-blur-xl border border-white/10 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100 shadow-xl"
                >
                    <ChevronRight size={24} />
                </button>

                {/* Indicators - Aesthetic Dots */}
                <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-30 flex gap-4">
                    {slides.map((_, i) => (
                        <button 
                            key={i} 
                            onClick={() => setCurrentSlide(i)}
                            className={`transition-all duration-500 rounded-full h-1.5 ${i === currentSlide ? 'w-10 bg-[#a391ff] shadow-[0_0_10px_rgba(163,145,255,0.8)]' : 'w-2 bg-white/30 hover:bg-white/60'}`}
                        />
                    ))}
                </div>
            </div>

            {/* ACTION SECTION BELOW THE HERO (Pearl & Taro System) */}
            <div className="px-6 md:px-12 pb-24 max-w-7xl mx-auto">
                <div className="flex flex-col items-center text-center mb-12">
                    {/* Welcome Text */}
                    <div className="w-full space-y-4">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-[#eae7e7] text-[#5a595f] text-xs font-bold uppercase tracking-widest mx-auto">
                            <Sparkles size={14} />
                            Portal del Distribuidor
                        </div>
                        <h1 className="text-4xl md:text-5xl font-black text-[#131313] leading-tight tracking-tight">
                            Te escuchamos, <span className="text-[#614eb7]">{user?.name?.split(' ')[0] || 'Socio'}</span>
                        </h1>
                        <p className="text-lg text-[#5f5f5f] font-normal mx-auto max-w-2xl">
                            Bienvenido a tu hub digital. Centraliza tus reposiciones de inventario, visualiza el crecimiento y garantiza siempre la mejor experiencia Popping Boba.
                        </p>
                    </div>
                </div>

                {/* Practical E-Commerce Navigation Menu */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-20 cursor-pointer">
                    <button 
                        onClick={() => navigate('/shop')}
                        className="p-10 bg-gradient-to-br from-[#614eb7] to-[#a391ff] hover:from-[#5441aa] hover:to-[#9684f1] text-white rounded-[2rem] shadow-[0_15px_35px_rgba(97,78,183,0.25)] hover:shadow-[0_20px_45px_rgba(97,78,183,0.35)] hover:-translate-y-2 transition-all flex flex-col items-center justify-center gap-4 group"
                    >
                        <ShoppingBag size={48} className="group-hover:scale-110 transition-transform" />
                        <span className="text-2xl font-bold tracking-tight">Tienda</span>
                    </button>
                    
                    <button 
                        onClick={() => navigate('/orders')}
                        className="p-10 bg-[#ffffff] hover:bg-[#f6f3f2] text-[#323232] rounded-[2rem] shadow-[0_10px_25px_rgba(0,0,0,0.04)] border border-[#e4e2e1] hover:-translate-y-2 transition-all flex flex-col items-center justify-center gap-4 group"
                    >
                        <PackageCheck size={48} className="text-[#a391ff] group-hover:scale-110 transition-transform" />
                        <span className="text-2xl font-bold tracking-tight">Mis Compras</span>
                    </button>

                    <button 
                        onClick={() => navigate('/pqr/list')}
                        className="p-10 bg-[#ffffff] hover:bg-[#f6f3f2] text-[#323232] rounded-[2rem] shadow-[0_10px_25px_rgba(0,0,0,0.04)] border border-[#e4e2e1] hover:-translate-y-2 transition-all flex flex-col items-center justify-center gap-4 group"
                    >
                        <ShieldCheck size={48} className="text-[#006b64] group-hover:scale-110 transition-transform" />
                        <span className="text-2xl font-bold tracking-tight">Garantías (PQR)</span>
                    </button>
                </div>

                {/* Info Cards - No Lines, Tonal Transitions */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div className="bg-[#ffffff] p-8 lg:p-10 rounded-[2rem] shadow-[0_10px_40px_rgba(50,50,50,0.03)] hover:shadow-[0_20px_50px_rgba(50,50,50,0.06)] transition-all hover:-translate-y-2 group">
                        <div className="w-14 h-14 bg-[#f2eff6] text-[#614eb7] rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                            <Heart size={26} className="fill-current" />
                        </div>
                        <h3 className="text-2xl font-bold text-[#323232] mb-3 tracking-tight">Calidad Premium</h3>
                        <p className="text-[#5f5f5f] leading-relaxed text-base">Infusiones seleccionadas y esferificaciones calibradas para un nivel superior en boca.</p>
                    </div>
                    <div className="bg-[#ffffff] p-8 lg:p-10 rounded-[2rem] shadow-[0_10px_40px_rgba(50,50,50,0.03)] hover:shadow-[0_20px_50px_rgba(50,50,50,0.06)] transition-all hover:-translate-y-2 group">
                        <div className="w-14 h-14 bg-[#e2fffa] text-[#006b64] rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                            <TrendingUp size={26} />
                        </div>
                        <h3 className="text-2xl font-bold text-[#323232] mb-3 tracking-tight">Stock Asegurado</h3>
                        <p className="text-[#5f5f5f] leading-relaxed text-base">Cero interrupciones. Elaboramos y conectamos de inmediato cualquier rotura de tu inventario.</p>
                    </div>
                    <div className="bg-[#ffffff] p-8 lg:p-10 rounded-[2rem] shadow-[0_10px_40px_rgba(50,50,50,0.03)] hover:shadow-[0_20px_50px_rgba(50,50,50,0.06)] transition-all hover:-translate-y-2 group">
                        <div className="w-14 h-14 bg-[#eae7e7] text-[#5a595f] rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                            <Sparkles size={26} />
                        </div>
                        <h3 className="text-2xl font-bold text-[#323232] mb-3 tracking-tight">Apoyo Continuo</h3>
                        <p className="text-[#5f5f5f] leading-relaxed text-base">Asesoría sommelier y rastreo transparente paso a paso hasta cada uno de tus puntos de venta.</p>
                    </div>
                </div>

            </div>
        </div>
    );
};

export default DistributorWelcome;
