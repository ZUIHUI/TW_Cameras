export default {
  fetch() {
    return Response.json({
      ok: true,
      service: "taiwan-live-cam-api",
      runtime: "vercel",
      time: new Date().toISOString()
    });
  }
};
