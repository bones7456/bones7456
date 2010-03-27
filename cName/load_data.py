#!/usr/bin/env python
# encoding: utf-8

"""
根据 gb2312.txt 和 data/ 生成 python 对象
"""

import string, os.path

def load():
    print 'loading...'
    en = list(': \n')
    en.extend(string.ascii_letters)
    en.extend(string.digits)
    __all, __bu, __hua, __yin = u'', {}, {}, {}
    if not os.path.exists('data'):
        os.mkdir('data')
    for line in open("gb2312.txt"):
        for char in unicode(line, 'utf8'):
            if char not in en:
                yin = line.split()[0]
                if yin in __yin:
                    __yin[yin] += char
                else:
                    __yin[yin] = char
                if char not in __all:
                    __all += char
                    bu, hua = parsechar(char)
                    if bu in __bu:
                        __bu[bu] += char
                    else:
                        __bu[bu] = char
                    if hua in __hua:
                        __hua[hua] += char
                    else:
                        __hua[hua] = char
    return __all, __bu, __hua, __yin

runpath = os.path.dirname(os.path.abspath(__file__))
black_file = os.path.join(runpath, 'black.data')
def parsechar(char):
    wiki = os.path.join(runpath, 'data', u'%s.wiki' % char)
    wiki = open(wiki)
    for line in wiki:
        line = unicode(line, 'utf8')
        if u'总笔画' in line:
            return (
                line.split(',')[0].split(':')[1],
                int(line.split(',')[2].split(':')[1])
                )
    print 'FAIL: ', char
    
def black():
    if os.path.exists(black_file):
        import pickle
        return pickle.load(open(black_file))
    else:
        return ('', '')
def save(tup):
    import pickle
    pickle.dump(tup, open(black_file, 'wb'))
if __name__ == '__main__':
    load()
    
