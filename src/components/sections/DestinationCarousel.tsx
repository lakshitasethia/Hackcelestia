"use client";

import { useState, useRef } from "react";
import Photo from "@/components/ui/Photo";
import { ChevronLeft, ChevronRight, ArrowUpRight, MapPin, Star } from "lucide-react";

export default function DestinationCarousel() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const destinations = [
    {
      id: "01",
      name: "Amalfi Coast & Capri",
      country: "Italy",
      image: "https://images.unsplash.com/photo-1533105079780-92b9be482077?q=80&w=1200&auto=format&fit=crop",
      descriptor: "Cliffside Mediterranean suites, private Riva boat charters, and secret lemon grove villas.",
      price: "$2,850",
      duration: "5-8 Days",
      rating: "4.98",
      tag: "Coastal Luxury",
    },
    {
      id: "02",
      name: "Kyoto & Mount Fuji",
      country: "Japan",
      image: "https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?q=80&w=1200&auto=format&fit=crop",
      descriptor: "Centuries-old private ryokans, master tea ceremonies, and bamboo grove sunrise walks.",
      price: "$3,200",
      duration: "7-10 Days",
      rating: "4.95",
      tag: "Cultural Immersion",
    },
    {
      id: "03",
      name: "Zermatt & Swiss Alps",
      country: "Switzerland",
      image: "https://images.unsplash.com/photo-1530122037265-a5f1f91d3b99?q=80&w=1200&auto=format&fit=crop",
      descriptor: "Matterhorn glacier views, scenic panoramic cogwheel rails, and secluded Alpine chalets.",
      price: "$3,650",
      duration: "6-9 Days",
      rating: "4.99",
      tag: "Alpine Retreat",
    },
    {
      id: "04",
      name: "Santorini & Cyclades",
      country: "Greece",
      image: "https://images.unsplash.com/photo-1570077188670-e3a8d69ac5ff?q=80&w=1200&auto=format&fit=crop",
      descriptor: "White-washed cliffside plunge pools, private caldera catamarans, and volcanic sunsets.",
      price: "$2,450",
      duration: "5-7 Days",
      rating: "4.97",
      tag: "Island Sanctuary",
    },
    {
      id: "05",
      name: "Banff & Lake Louise",
      country: "Canada",
      image: "https://images.unsplash.com/photo-1517411032315-54ef2cb783bb?q=80&w=1200&auto=format&fit=crop",
      descriptor: "Turquoise glacial lakes, private heli-hiking trails, and secluded wilderness timber lodges.",
      price: "$2,150",
      duration: "6-8 Days",
      rating: "4.92",
      tag: "Wilderness Luxe",
    },
    {
      id: "06",
      name: "Serengeti & Zanzibar",
      country: "Tanzania",
      image: "https://images.unsplash.com/photo-1516426122078-c23e76319801?q=80&w=1200&auto=format&fit=crop",
      descriptor: "Private Great Migration game drives, dawn hot air balloon flights, and spice island retreats.",
      price: "$4,400",
      duration: "8-12 Days",
      rating: "4.99",
      tag: "Safari & Coast",
    },
  ];

  const handlePrev = () => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : destinations.length - 1));
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: -360, behavior: "smooth" });
    }
  };

  const handleNext = () => {
    setCurrentIndex((prev) => (prev < destinations.length - 1 ? prev + 1 : 0));
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: 360, behavior: "smooth" });
    }
  };

  return (
    <section id="destinations" data-scroll-theme="dark" className="py-20 sm:py-28 border-b border-line overflow-hidden">
      <div className="max-w-[110rem] mx-auto px-5 sm:px-8 lg:px-12">
        
        {/* Header Row with Title and Numbered Pagination Controls */}
        <div data-reveal className="flex flex-col md:flex-row md:items-end justify-between mb-12 sm:mb-16 gap-6">
          <div>
            <span className="eyebrow">· CURATED COLLECTION ·</span>
            <h2 className="font-display text-display-lg font-semibold uppercase text-fg">
              Where will you go?
            </h2>
            <p className="mt-3 text-base text-muted font-medium max-w-xl">
              Every destination is completely modular. Choose a blueprint and customize every hotel, transfer, and activity to your exact vision.
            </p>
          </div>

          {/* Numbered Pagination Indicator & Circular Arrow Controls */}
          <div className="flex items-center gap-6 self-start md:self-auto">
            <div className="font-sans text-sm sm:text-base font-bold tracking-widest text-fg">
              <span className="text-accent font-extrabold">0{currentIndex + 1}</span>
              <span className="text-muted mx-2">/</span>
              <span>0{destinations.length}</span>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handlePrev}
                aria-label="Previous destination"
                className="w-12 h-12 rounded-full border border-line bg-surface text-fg flex items-center justify-center transition-all hover:bg-surface active:translate-x-0.5 active:translate-y-0.5"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                onClick={handleNext}
                aria-label="Next destination"
                className="w-12 h-12 rounded-full border border-line bg-fg text-bg flex items-center justify-center transition-all hover:bg-fg active:translate-x-0.5 active:translate-y-0.5"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Horizontal Scrollable Row of Destination Cards */}
        <div
          ref={scrollContainerRef}
          className="flex gap-6 overflow-x-auto pb-8 scrollbar-none snap-x snap-mandatory"
        >
          {destinations.map((dest) => (
            <div
              key={dest.id}
              data-cursor="view"
              className="surface shrink-0 w-[300px] sm:w-[360px] lg:w-[380px] group relative snap-start overflow-hidden hover:border-line"
            >
              {/* Card Image Container */}
              <div className="relative h-[260px] sm:h-[300px] w-full overflow-hidden border-b border-line">
                <Photo
                  src={dest.image}
                  alt={`${dest.name}, ${dest.country}`}
                  fill
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                  sizes="(max-width: 768px) 300px, 380px"
                />
                
                {/* Top Badge */}
                <div className="absolute top-3 left-3 bg-surface border border-line px-2.5 py-1 text-[10px] font-sans font-bold uppercase tracking-wider text-fg">
                  {dest.tag}
                </div>

                {/* Rating Badge */}
                <div className="absolute top-3 right-3 bg-fg text-bg px-2 py-1 text-[11px] font-sans font-bold flex items-center gap-1">
                  <Star className="w-3 h-3 text-accent fill-accent" />
                  {dest.rating}
                </div>

                {/* Floating "View Itinerary" overlay prompt on hover */}
                <div className="absolute inset-0 bg-surface opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                  <div className="bg-surface border border-line px-4 py-2 text-xs font-sans font-bold uppercase tracking-widest text-fg flex items-center gap-1.5">
                    <span>Customize Route</span>
                    <ArrowUpRight className="w-4 h-4 text-accent" />
                  </div>
                </div>
              </div>

              {/* Card Details */}
              <div className="p-5 flex flex-col justify-between h-[210px] bg-surface">
                <div>
                  <div className="flex items-center gap-1.5 text-accent font-sans text-xs font-bold uppercase tracking-wider mb-1">
                    <MapPin className="w-3.5 h-3.5" />
                    {dest.country} · {dest.duration}
                  </div>
                  <h3 className="font-display text-display-sm font-semibold uppercase text-fg group-hover:text-accent transition-colors">
                    {dest.name}
                  </h3>
                  <p className="text-xs text-muted mt-2 line-clamp-2 leading-relaxed font-medium">
                    {dest.descriptor}
                  </p>
                </div>

                {/* Pricing & CTA */}
                <div className="flex items-center justify-between border-t border-line pt-3 mt-3">
                  <div>
                    <span className="font-sans text-[10px] uppercase text-muted block">From</span>
                    <span className="font-sans text-base font-extrabold text-fg">{dest.price}</span>
                    <span className="font-sans text-[10px] text-muted ml-1">/ person</span>
                  </div>

                  <a
                    href="#how-it-works"
                    className="font-sans text-xs uppercase font-bold text-fg group-hover:text-accent flex items-center gap-1"
                  >
                    <span>Build</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>

      </div>
    </section>
  );
}
