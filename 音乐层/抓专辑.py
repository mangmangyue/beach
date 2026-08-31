#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从一条 Spotify 专辑链接，打印一段可以直接粘进 albums.js 的数据。

  python3 音乐层/抓专辑.py "https://open.spotify.com/album/6b08FpNaFFTjc1dJ9DSWfn"
  python3 音乐层/抓专辑.py 6b08FpNaFFTjc1dJ9DSWfn --id modal-soul --cover covers/modal-soul.jpg

为什么能不用 API key：
  Spotify 的嵌入页 open.spotify.com/embed/album/<id> 里有一段 __NEXT_DATA__ JSON，
  完整曲目、时长、每首的 track id 都在里面，公开可读。
  官方 Web API 要 token，这条路不用 —— 反正播放器本来就靠嵌入页。

只是个抄写员：它不改任何文件，只往终端打印。粘不粘、粘哪儿，你说了算。
"""
import json, re, sys, urllib.request

UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'}


def entity(kind, sid):
    req = urllib.request.Request(f'https://open.spotify.com/embed/{kind}/{sid}', headers=UA)
    html = urllib.request.urlopen(req, timeout=30).read().decode('utf-8')
    m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html, re.S)
    if not m:
        raise SystemExit('嵌入页里没找到数据。链接对吗？这张碟在你的区可听吗？')
    return json.loads(m.group(1))['props']['pageProps']['state']['data']['entity']


def spotify_id(text):
    text = text.strip()
    if re.fullmatch(r'[A-Za-z0-9]{22}', text):
        return text
    m = re.search(r'album[:/]([A-Za-z0-9]{22})', text)
    if not m:
        raise SystemExit('这不像一条专辑链接。到 Spotify 里「分享 → 复制链接」再粘一次。')
    return m.group(1)


def js(s):
    return "'" + str(s).replace('\\', '\\\\').replace("'", "\\'") + "'"


def mmss(ms):
    sec = round(ms / 1000)
    return f'{sec // 60}:{sec % 60:02d}'


def slug(title):
    s = re.sub(r"[^a-z0-9]+", '-', title.lower()).strip('-')
    return s or 'album'


def main(argv):
    if not argv:
        raise SystemExit(__doc__)
    aid = spotify_id(argv[0])
    opts = dict(zip(argv[1::2], argv[2::2]))

    album = entity('album', aid)
    tracks = album.get('trackList', [])

    # 专辑嵌入页不给发行年，去第一首的嵌入页拿
    year = 'null'
    if tracks:
        try:
            iso = (entity('track', tracks[0]['uri'].split(':')[-1]).get('releaseDate') or {}).get('isoString')
            if iso:
                year = iso[:4]
        except Exception:
            pass

    key = opts.get('--id') or slug(album['name'])
    artist = album.get('subtitle', '')
    cover = opts.get('--cover') or f'covers/{key}.jpg'

    print(f"\n  # 封面记得放到 音乐层/{cover}（正方形 jpg，512×512 左右）\n")
    print('  {')
    print(f"    id: {js(key)},")
    print(f"    title: {js(album['name'])},")
    print(f"    artist: {js(artist)},")
    print(f"    year: {year},")
    print(f"    cover: {js(cover)},")
    print(f"    spotifyAlbum: {js(aid)},")
    print('    tracks: [')
    width = max((len(js(t['title'])) for t in tracks), default=0)
    for t in tracks:
        extra = ''
        sub = t.get('subtitle', '')
        if sub and sub != artist:
            extra = f" artist: {js(sub)},"
        print(f"      {{ title: {js(t['title']):<{width}}, duration: '{mmss(t['duration'])}',"
              f" spotifyTrack: '{t['uri'].split(':')[-1]}',{extra} }},")
    print('    ],')
    print('  },')
    print(f"\n  # {len(tracks)} 首。粘进 音乐层/albums.js 的 ALBUMS 数组里。\n")


if __name__ == '__main__':
    main(sys.argv[1:])
