export default function PlaceholderPage({ title, icon }: { title: string; icon: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-[60vh] text-center">
      <div className="w-16 h-16 flex items-center justify-center bg-gray-100 rounded-2xl mb-5">
        <i className={`${icon} text-2xl text-gray-400`}></i>
      </div>
      <h2 className="text-xl font-semibold text-gray-700 mb-2" style={{ fontFamily: "'DM Sans', sans-serif" }}>
        {title}
      </h2>
      <p className="text-sm text-gray-400 max-w-sm">
        This section is being built. Check back in the next phase!
      </p>
    </div>
  );
}