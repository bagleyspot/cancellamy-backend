import { htmlToText } from './html-to-text';

describe('htmlToText', () => {
  it('keeps line breaks and removes tags, scripts and styles', () => {
    expect(htmlToText('<style>p{}</style><p>Ciao</p><p>mondo<br/>fine<script>alert(1)</script></p>')).toBe('Ciao\n\nmondo\nfine');
  });

  it('does not let nested fragments recombine into a tag', () => {
    expect(htmlToText('<scr<b>ipt>alert(1)</scr</b>ipt>x')).not.toMatch(/<\/?script/i);
    expect(htmlToText('<scr<script>x</script>ipt>alert(1)</script>y')).not.toMatch(/<\/?script/i);
  });

  it('drops an unterminated tag or script block instead of leaking it', () => {
    expect(htmlToText('visible<script>alert(1)')).toBe('visible');
    expect(htmlToText('visible <b')).toBe('visible');
  });

  it('accepts whitespace inside closing tags', () => {
    expect(htmlToText('a<script>x</script >b')).toBe('ab');
  });

  it('decodes ampersands last and leaves angle-bracket entities encoded', () => {
    expect(htmlToText('a &amp;lt; b &amp; c &lt;d&gt; &nbsp;e')).toBe('a &lt; b & c &lt;d&gt;  e');
  });
});
